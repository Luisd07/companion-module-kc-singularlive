import fetch from 'node-fetch'

const url = 'https://app.singular.live/apiv2/controlapps/'
const TIMEOUT_MS = 5000

export default class SingularLive {
	rootCompName = 'Root Composition'
	rootCompId = undefined

	constructor(apiurl) {
		if (apiurl && apiurl.includes('/')) {
			let urlparts = apiurl.split('/')
			this.token = urlparts[urlparts.length - 1]
		} else {
			this.token = apiurl
		}
	}

	// Low-level fetch with an abort timeout. Throws on network error / timeout /
	// abort. Used by the read methods, which want to reject so callers can catch.
	async _fetch(path, options) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
		try {
			return await fetch(url + this.token + path, { ...options, signal: controller.signal })
		} finally {
			clearTimeout(timer)
		}
	}

	// Write helper for control/command calls. NEVER throws or rejects — always
	// resolves to { ok, status?, error? } so a fire-and-forget call can't become
	// an unhandled promise rejection, and awaiting callers can gate on success.
	async _send(path, options) {
		try {
			const res = await this._fetch(path, options)
			return { ok: res.ok, status: res.status }
		} catch (error) {
			return { ok: false, error }
		}
	}

	async Connect() {
		const res = await this._fetch('', this.GETOption())
		if (res.status !== 200) throw new Error(res.statusText || `HTTP ${res.status}`)
		return res.json()
	}

	getNodes(model) {
		return Object.entries(model).map((entry) => {
			return {
				[entry[1].id]: {
					id: entry[1].id,
					title: entry[1].title,
					type: entry[1].type,
					...(entry[1].selections && { selections: entry[1].selections }),
				},
			}
		})
	}

	async getElements() {
		const res = await this._fetch('/model', this.GETOption())
		if (!res.ok) throw new Error(`Model fetch failed: HTTP ${res.status}`)

		const result = await res.json()
		if (!Array.isArray(result) || !result[0]) throw new Error('Unexpected model response')

		this.rootCompId = result[0].id
		const data = result[0].subcompositions ?? []
		const elements = [
			{
				id: result[0].id,
				name: this.rootCompName,
				nodes: result[0].model ? this.getNodes(result[0].model) : [],
			},
		]
		for (let i = 0; i < data.length; i++) {
			elements.push({
				id: data[i].id,
				name: data[i].name,
				nodes: data[i].model ? this.getNodes(data[i].model) : [],
			})
		}
		return elements
	}

	async getModelStates() {
		const res = await this._fetch('/model', this.GETOption())
		if (!res.ok) throw new Error(`Model fetch failed: HTTP ${res.status}`)

		const result = await res.json()
		const states = {}
		for (const comp of result?.[0]?.subcompositions ?? []) {
			if (comp.name) states[comp.name] = comp.state ?? 'Out'
		}
		return states
	}

	subcompIdentifier(composition) {
		return composition === this.rootCompName
			? { subCompositionId: this.rootCompId }
			: { subCompositionName: composition }
	}

	animateIn(composition) {
		if (!composition) return Promise.resolve({ ok: false })

		const body = [{ ...this.subcompIdentifier(composition), state: 'In' }]
		return this._send('/control', this.PATCHOption(body))
	}

	animateOut(composition) {
		if (!composition) return Promise.resolve({ ok: false })

		const body = [{ ...this.subcompIdentifier(composition), state: 'Out' }]
		return this._send('/control', this.PATCHOption(body))
	}

	/**
	 * Set several compositions' states in a single PATCH so they fire together.
	 * entries: [{ composition, state }] where state is 'In' | 'Out'.
	 */
	setStates(entries) {
		if (!Array.isArray(entries) || entries.length === 0) return Promise.resolve({ ok: false })

		const body = entries
			.filter((entry) => entry && entry.composition && entry.state)
			.map((entry) => ({ ...this.subcompIdentifier(entry.composition), state: entry.state }))

		if (body.length === 0) return Promise.resolve({ ok: false })

		return this._send('/control', this.PATCHOption(body))
	}

	updateControlNode(controlnode, value) {
		if (!controlnode) return Promise.resolve({ ok: false })

		const body = [
			{
				...this.subcompIdentifier(controlnode.split('&!&!&')[0]),
				payload: {
					[controlnode.split('&!&!&')[1]]: value,
				},
			},
		]

		return this._send('/control', this.PATCHOption(body))
	}

	updatePayload(composition, payload) {
		if (!composition || !payload || typeof payload !== 'object') return Promise.resolve({ ok: false })

		const body = [
			{
				...this.subcompIdentifier(composition),
				payload,
			},
		]

		return this._send('/control', this.PATCHOption(body))
	}

	updateButtonNode(controlnode) {
		if (!controlnode) return Promise.resolve({ ok: false })

		const body = [
			{
				...this.subcompIdentifier(controlnode.split('&!&!&')[0]),
				payload: {
					[controlnode.split('&!&!&')[1]]: 'execute',
				},
			},
		]

		return this._send('/control', this.PATCHOption(body))
	}

	/**
	 * Execute several button nodes in a single PATCH. Buttons in the same
	 * composition are merged into one payload so they fire together.
	 * controlnodes: array of `comp&!&!&nodeId` strings.
	 */
	pressButtons(controlnodes) {
		if (!Array.isArray(controlnodes) || controlnodes.length === 0) return Promise.resolve({ ok: false })

		const byComp = new Map()
		for (const controlnode of controlnodes) {
			const [comp, nodeId] = controlnode.split('&!&!&')
			if (!comp || !nodeId) continue
			if (!byComp.has(comp)) byComp.set(comp, {})
			byComp.get(comp)[nodeId] = 'execute'
		}

		const body = [...byComp.entries()].map(([comp, payload]) => ({ ...this.subcompIdentifier(comp), payload }))
		if (body.length === 0) return Promise.resolve({ ok: false })

		return this._send('/control', this.PATCHOption(body))
	}

	updateCheckboxNode(controlnode, value) {
		if (!controlnode) return Promise.resolve({ ok: false })

		const body = [
			{
				...this.subcompIdentifier(controlnode.split('&!&!&')[0]),
				payload: {
					[controlnode.split('&!&!&')[1]]: value,
				},
			},
		]

		return this._send('/control', this.PATCHOption(body))
	}

	updateColorNode(controlnode, value) {
		if (!controlnode) return Promise.resolve({ ok: false })

		const body = [
			{
				...this.subcompIdentifier(controlnode.split('&!&!&')[0]),
				payload: {
					[controlnode.split('&!&!&')[1]]: value,
				},
			},
		]
		return this._send('/control', this.PATCHOption(body))
	}

	updateTimer(controlnode, value) {
		if (!controlnode || !value) return Promise.resolve({ ok: false })

		const body = [
			{
				...this.subcompIdentifier(controlnode.split('&!&!&')[0]),
				payload: {
					[controlnode.split('&!&!&')[1]]: {
						command: value,
					},
				},
			},
		]

		return this._send('/control', this.PATCHOption(body))
	}

	takeOutAllOutput() {
		return this._send('/command', this.POSTOption({ action: 'TakeOutAllOutput' }))
	}

	refreshComposition() {
		return this._send('/command', this.POSTOption({ action: 'RefreshComposition' }))
	}

	BaseOption() {
		return {
			contentType: 'application/json',
			mode: 'cors',
			headers: {
				'content-type': 'application/json',
			},
		}
	}

	GETOption() {
		return Object.assign({}, this.BaseOption(), { method: 'GET' })
	}

	PUTOption(body) {
		return Object.assign({}, this.BaseOption(), { method: 'PUT', body: JSON.stringify(body).replace(/\\\\n/g, '\\n') })
	}

	PATCHOption(body) {
		return Object.assign({}, this.BaseOption(), {
			method: 'PATCH',
			body: JSON.stringify(body).replace(/\\\\n/g, '\\n'),
		})
	}

	POSTOption(body) {
		return Object.assign({}, this.BaseOption(), { method: 'POST', body: JSON.stringify(body).replace(/\\\\n/g, '\\n') })
	}
}

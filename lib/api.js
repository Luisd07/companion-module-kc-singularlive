import fetch from 'node-fetch'

const url = 'https://app.singular.live/apiv2/controlapps/'
const TIMEOUT_MS = 5000

// Live values come back as strings, numbers, booleans or objects (gradients,
// timer controls, button stamps). Objects are stringified so a variable shows
// something inspectable rather than "[object Object]".
export function formatLiveValue(value) {
	if (value === null || value === undefined) return ''
	if (typeof value === 'object') return JSON.stringify(value)
	return String(value)
}

export default class SingularLive {
	rootCompName = 'Root Composition'
	rootCompId = undefined

	// onRequest, if given, is invoked once per outbound HTTP call, for quota counting.
	constructor(apiurl, onRequest) {
		if (apiurl && apiurl.includes('/')) {
			let urlparts = apiurl.split('/')
			this.token = urlparts[urlparts.length - 1]
		} else {
			this.token = apiurl
		}
		this.onRequest = typeof onRequest === 'function' ? onRequest : null
	}

	// Low-level fetch with an abort timeout. Throws on network error / timeout /
	// abort. Used by the read methods, which want to reject so callers can catch.
	async _fetch(path, options) {
		// Counted before the await — a timed-out request still consumed quota.
		this.onRequest?.()

		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
		try {
			return await fetch(url + this.token + path, { ...options, signal: controller.signal })
		} finally {
			clearTimeout(timer)
		}
	}

	// Write helper for control/command calls. NEVER throws or rejects — always
	// resolves to { ok, status?, error?, detail? } so a fire-and-forget call can't
	// become an unhandled promise rejection, and awaiting callers can gate on
	// success. On failure `detail` carries the API's own explanation — a bare
	// "HTTP 400" is undiagnosable.
	async _send(path, options) {
		try {
			const res = await this._fetch(path, options)
			if (res.ok) return { ok: true, status: res.status }

			let detail
			try {
				detail = (await res.text())?.slice(0, 500)
			} catch {
				detail = undefined
			}
			return { ok: false, status: res.status, detail, request: options?.body }
		} catch (error) {
			return { ok: false, error }
		}
	}

	async Connect() {
		const res = await this._fetch('', this.GETOption())
		if (res.status !== 200) throw new Error(res.statusText || `HTTP ${res.status}`)
		return res.json()
	}

	// Projects the raw model down to the fields the module consumes. defaultValue /
	// min / max drive number clamping and selection reset, so they must survive the
	// projection; each is optional per node type and spread in only when present.
	getNodes(model) {
		return Object.entries(model).map((entry) => {
			return {
				[entry[1].id]: {
					id: entry[1].id,
					title: entry[1].title,
					type: entry[1].type,
					...(entry[1].selections && { selections: entry[1].selections }),
					...(entry[1].defaultValue !== undefined && { defaultValue: entry[1].defaultValue }),
					...(entry[1].min !== undefined && { min: entry[1].min }),
					...(entry[1].max !== undefined && { max: entry[1].max }),
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

	/**
	 * Read live state in one call: every sub-composition's animation state plus
	 * the current value of every control node that has one. This is the polling
	 * endpoint — /model is only read once at connect, for structure. /control is
	 * roughly half the payload and is the only endpoint returning live values
	 * rather than defaults.
	 *
	 * Returns { states: { comp: 'In' | 'Out' }, values: { 'comp&!&!&nodeId': value } }.
	 *
	 * Two shape notes from the live API: the main composition is flagged rather
	 * than named, so it is mapped back to rootCompName to match getElements();
	 * and nested sub-compositions can repeat a name (Row01 appears three times in
	 * one show), so last-writer-wins here. Those nested comps are absent from
	 * /model and therefore never appear in the module's choices.
	 */
	async getControlState() {
		const res = await this._fetch('/control', this.GETOption())
		if (!res.ok) throw new Error(`Control fetch failed: HTTP ${res.status}`)

		const result = await res.json()
		const states = {}
		const values = {}

		for (const entry of Array.isArray(result) ? result : []) {
			const name = entry.mainComposition ? this.rootCompName : entry.subCompositionName
			if (!name) continue

			states[name] = SingularLive.normalizeState(entry.state)
			for (const [nodeId, value] of Object.entries(entry.payload ?? {})) {
				values[`${name}&!&!&${nodeId}`] = value
			}
		}

		return { states, values }
	}

	// Singular reports several distinct out-states ("Out1", "Out2", ...) but the
	// module only ever commands a binary In/Out. Collapsing them here keeps polled
	// state from fighting the optimistic state written after a Companion take.
	static normalizeState(state) {
		return String(state ?? '').startsWith('In') ? 'In' : 'Out'
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

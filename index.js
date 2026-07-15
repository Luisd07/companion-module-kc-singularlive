import { InstanceBase, runEntrypoint } from '@companion-module/base'

import { getActions } from './actions.js'
import { getFeedbacks } from './feedbacks.js'
import api from './lib/api.js'

const MAX_APPS = 8

// Variable id helpers — shared with value updates so definitions and values agree.
const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9]+/g, '_')
const compStateVarId = (appKey, comp) => `comp_${appKey}_${sanitize(comp)}_state`
const selValueVarId = (appKey, node) => `sel_${appKey}_${sanitize(node)}`
const selLabelVarId = (appKey, node) => `sel_${appKey}_${sanitize(node)}_label`

class SingularInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		// Tracks the current index per cycled selection node, keyed by
		// `${token}|${controlnodeId}`. In-memory only (persisted in a later version).
		this.cycleState = new Map()
		// Composition on-air states from polling, keyed by `${token}|${compName}`.
		this.compStates = new Map()
		// Values Companion last set per selection node, keyed by `${token}|${controlnodeId}`.
		// Not authoritative — data streams / composition JS can change the real value.
		this.selValues = new Map()
		// Human-readable label of the value Companion last set (same key as selValues).
		this.selLabels = new Map()
		// Pending auto-take-out timers, keyed by `${token}|${compName}`.
		this.autoOutTimers = new Map()
		this.lastAction = ''
		this.pollTimer = null
	}

	async init(config) {
		this.config = config
		this.connections = new Map()
		this.updateStatus('connecting')
		this.initSingularLive(this.config)
	}

	async destroy() {
		this.stopPolling()
		this.clearAllAutoOut()
		this.connections = new Map()
		this.compStates = new Map()
		this.log('debug', 'Singular module destroyed')
	}

	getConfigFields() {
		const fields = [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value:
					'This module can control multiple Singular.live Control Apps. Each app requires an API URL or token, ' +
					'generated in the Manage Access settings window from the Control application. ' +
					'Set the number of apps below, then enter a name and token for each.',
			},
			{
				type: 'number',
				id: 'numApps',
				label: 'Number of Control Apps',
				width: 12,
				min: 1,
				max: MAX_APPS,
				default: 1,
			},
		]

		for (let i = 0; i < MAX_APPS; i++) {
			const isVisible = new Function('options', `return Number(options.numApps || 1) > ${i}`)
			fields.push(
				{
					type: 'textinput',
					id: `app_${i}_name`,
					label: `App ${i + 1} Name`,
					width: 4,
					default: '',
					isVisible,
				},
				{
					type: 'textinput',
					id: `app_${i}_token`,
					label: `App ${i + 1} API URL / Token`,
					width: 8,
					default: '',
					isVisible,
				},
			)
		}

		fields.push({
			type: 'number',
			id: 'pollInterval',
			label: 'Polling interval (seconds, 0 = off)',
			tooltip:
				'How often to poll Singular for composition on-air state. Companion-driven takes update instantly ' +
				'regardless of this; polling only catches takes made outside Companion. 1-2s feels live; lower adds API load.',
			width: 12,
			min: 0,
			max: 60,
			default: 2,
		})

		return fields
	}

	async configUpdated(config) {
		this.config = config
		this.initSingularLive(this.config)
	}

	parseApps(config) {
		const apps = []
		const count = Math.min(Math.max(Number(config.numApps) || 1, 1), MAX_APPS)

		for (let i = 0; i < count; i++) {
			let token = (config[`app_${i}_token`] || '').trim()
			if (i === 0 && !token && config.apiurl) {
				token = String(config.apiurl).trim()
			}
			if (!token) continue

			const name = (config[`app_${i}_name`] || '').trim()
			apps.push({
				key: String(i),
				label: name || `App ${i + 1}`,
				token,
			})
		}

		return apps
	}

	buildChoices(elements) {
		const compositions = []
		const controlnodes = []
		const buttons = []
		const checkboxes = []
		const timers = []
		const selections = []
		const colors = []
		// Per-composition list of simple key->value payload nodes, used to show a
		// live "available node ids" hint in the batch payload action.
		const payloadNodes = {}

		for (let i = 0; i < elements.length; i++) {
			if (!elements[i].name) continue

			compositions.push({
				id: elements[i].name,
				label: elements[i].name,
			})
			payloadNodes[elements[i].name] = []

			if (!elements[i].nodes) continue

			const titles = new Set()
			const duplicateTitles = new Set()

			let nodes = elements[i].nodes.reduce((r, c) => {
				const title = Object.values(c)[0].title
				const titleSeenBefore = titles.has(title)
				if (titleSeenBefore) {
					duplicateTitles.add(title)
				} else {
					titles.add(title)
				}
				return Object.assign(r, c)
			}, {})

			const nodeIds = Object.keys(nodes)
			for (let j = 0; j < nodeIds.length; j++) {
				const node = nodes[nodeIds[j]]
				const nodeLabel = duplicateTitles.has(node.title) ? `${node.title} (${node.id})` : node.title

				const controlNode = {
					id: elements[i].name + '&!&!&' + node.id,
					label: elements[i].name + ' / ' + nodeLabel,
				}

				switch (node.type) {
					case 'text':
					case 'number':
					case 'textarea':
					case 'image':
						controlnodes.push(controlNode)
						payloadNodes[elements[i].name].push({ id: node.id, title: nodeLabel })
						break
					case 'button':
						buttons.push(controlNode)
						break
					case 'timecontrol':
						timers.push(controlNode)
						break
					case 'checkbox':
						checkboxes.push(controlNode)
						break
					case 'color':
						colors.push(controlNode)
						break
					case 'selection':
						selections.push({
							...controlNode,
							selections: node.selections?.map((selection) => ({
								id: selection.id,
								label: selection.title,
							})),
						})
						break
					default:
						controlnodes.push(controlNode)
						payloadNodes[elements[i].name].push({ id: node.id, title: nodeLabel })
				}
			}
		}

		return { compositions, controlnodes, buttons, checkboxes, timers, selections, colors, payloadNodes }
	}

	async initSingularLive(config) {
		this.stopPolling()
		this.clearAllAutoOut()
		this.connections = new Map()

		const apps = this.parseApps(config)
		if (apps.length === 0) {
			this.updateStatus('bad_config', 'No API URL or token configured')
			this.setActionDefinitions(getActions.bind(this)([], {}))
			this.setFeedbackDefinitions(getFeedbacks.bind(this)([], {}))
			this.setVariableDefinitions([])
			this.appChoices = []
			this.choicesByToken = {}
			return
		}

		const appChoices = []
		const choicesByToken = {}
		let okCount = 0

		for (const app of apps) {
			try {
				const conn = new api(app.token)
				await conn.Connect()
				const elements = await conn.getElements()

				this.connections.set(app.key, conn)
				choicesByToken[app.key] = this.buildChoices(elements)
				appChoices.push({ id: app.key, label: app.label })
				okCount++
			} catch (err) {
				const reason = err && err.toString().toLowerCase() === 'not found' ? 'Invalid token' : err
				this.log('warn', `Control App "${app.label}": ${reason}`)
			}
		}

		this.appChoices = appChoices
		this.choicesByToken = choicesByToken

		this.setActionDefinitions(getActions.bind(this)(appChoices, choicesByToken))
		this.setFeedbackDefinitions(getFeedbacks.bind(this)(appChoices, choicesByToken))
		this.setVariableDefinitions(this.buildVariableDefinitions(appChoices, choicesByToken))
		this.initVariableValues(appChoices, choicesByToken)

		if (okCount === apps.length) {
			this.updateStatus('ok')
		} else if (okCount > 0) {
			this.updateStatus('ok', `${apps.length - okCount} of ${apps.length} apps failed to connect`)
		} else {
			this.updateStatus('connection_failure')
		}

		this.startPolling()
	}

	buildVariableDefinitions(appChoices, choicesByToken) {
		const defs = [{ variableId: 'last_action', name: 'Last action' }]

		for (const app of appChoices) {
			const choices = choicesByToken[app.id]
			for (const comp of choices.compositions) {
				defs.push({ variableId: compStateVarId(app.id, comp.id), name: `${app.label} / ${comp.label} — state` })
			}
			for (const sel of choices.selections) {
				defs.push({ variableId: selValueVarId(app.id, sel.id), name: `${app.label} / ${sel.label} — value (last set)` })
				defs.push({ variableId: selLabelVarId(app.id, sel.id), name: `${app.label} / ${sel.label} — label (last set)` })
			}
		}

		return defs
	}

	initVariableValues(appChoices, choicesByToken) {
		const values = { last_action: this.lastAction }

		for (const app of appChoices) {
			const choices = choicesByToken[app.id]
			for (const comp of choices.compositions) {
				values[compStateVarId(app.id, comp.id)] = this.compStates.get(`${app.id}|${comp.id}`) ?? ''
			}
			for (const sel of choices.selections) {
				values[selValueVarId(app.id, sel.id)] = this.selValues.get(`${app.id}|${sel.id}`) ?? ''
				values[selLabelVarId(app.id, sel.id)] = this.selLabels.get(`${app.id}|${sel.id}`) ?? ''
			}
		}

		this.setVariableValues(values)
	}

	updateStateVariables() {
		if (!this.appChoices) return

		const values = {}
		for (const app of this.appChoices) {
			for (const comp of this.choicesByToken[app.id].compositions) {
				values[compStateVarId(app.id, comp.id)] = this.compStates.get(`${app.id}|${comp.id}`) ?? ''
			}
		}

		this.setVariableValues(values)
	}

	// Record a value Companion set for a selection node so feedbacks/variables can
	// reflect it. Not authoritative — streams/JS can change the real value.
	recordSelection(token, controlnode, value, label) {
		if (!token || !controlnode) return

		const key = `${token}|${controlnode}`
		this.selValues.set(key, value)
		const values = { [selValueVarId(token, controlnode)]: value }

		if (label !== undefined) {
			this.selLabels.set(key, label)
			values[selLabelVarId(token, controlnode)] = label
		}

		this.setVariableValues(values)
		this.checkFeedbacks('selectionActiveValue')
	}

	recordAction(description) {
		this.lastAction = description
		this.setVariableValues({ last_action: description })
	}

	// Optimistically update a composition's on-air state so feedback is instant
	// for Companion-driven takes, without waiting for the next poll.
	recordCompState(token, comp, state) {
		if (!token || !comp) return

		this.compStates.set(`${token}|${comp}`, state)
		this.setVariableValues({ [compStateVarId(token, comp)]: state })
		this.checkFeedbacks('compositionIsIn')
	}

	// Take Out All clears every composition in the app — reflect that at once,
	// and cancel any pending auto-take-out timers for the app.
	recordAllOut(token) {
		const comps = this.choicesByToken?.[token]?.compositions ?? []
		const values = {}
		for (const comp of comps) {
			this.compStates.set(`${token}|${comp.id}`, 'Out')
			values[compStateVarId(token, comp.id)] = 'Out'
		}
		this.setVariableValues(values)
		this.checkFeedbacks('compositionIsIn')

		const prefix = `${token}|`
		const keys = [...this.autoOutTimers.keys()].filter((key) => key.startsWith(prefix))
		for (const key of keys) {
			this.clearAutoOut(token, key.slice(prefix.length))
		}
	}

	// Take In a composition, then auto Take Out after `seconds`. Re-triggering
	// the same composition cancels the pending take-out and restarts the timer.
	async takeInWithTimeout(token, comp, seconds) {
		const conn = this.connections?.get(token)
		if (!conn || !comp) return

		await conn.animateIn(comp)
		this.recordCompState(token, comp, 'In')
		this.scheduleAutoOut(token, comp, seconds)
	}

	scheduleAutoOut(token, comp, seconds) {
		this.clearAutoOut(token, comp)

		const secs = Math.max(0, Number(seconds) || 0)
		if (secs <= 0) return

		const key = `${token}|${comp}`
		const id = setTimeout(() => {
			this.autoOutTimers.delete(key)
			const conn = this.connections?.get(token)
			if (conn) {
				conn.animateOut(comp)
				this.recordCompState(token, comp, 'Out')
			}
			this.checkFeedbacks('timedTakeOutActive')
		}, secs * 1000)

		this.autoOutTimers.set(key, id)
		this.checkFeedbacks('timedTakeOutActive')
	}

	clearAutoOut(token, comp) {
		const key = `${token}|${comp}`
		const id = this.autoOutTimers.get(key)
		if (id) {
			clearTimeout(id)
			this.autoOutTimers.delete(key)
			this.checkFeedbacks('timedTakeOutActive')
		}
	}

	clearAllAutoOut() {
		for (const id of this.autoOutTimers.values()) clearTimeout(id)
		this.autoOutTimers.clear()
		this.checkFeedbacks('timedTakeOutActive')
	}

	startPolling() {
		this.stopPolling()

		// Poll immediately so state is fresh, then on the configured interval.
		this.pollStates()

		const interval = this.config?.pollInterval ?? 2
		const seconds = Math.max(0, Number(interval) || 0)
		if (seconds > 0) {
			this.pollTimer = setInterval(() => this.pollStates(), seconds * 1000)
		}
	}

	stopPolling() {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
	}

	async pollStates() {
		if (!this.connections || this.connections.size === 0) return
		// Overlap guard: never let a new poll start while one is still in flight,
		// so a fast interval can't stack up requests against the API.
		if (this.polling) return
		this.polling = true

		try {
			for (const [key, conn] of this.connections) {
				try {
					const states = await conn.getModelStates()
					for (const [comp, state] of Object.entries(states)) {
						this.compStates.set(`${key}|${comp}`, state)
					}
				} catch (err) {
					this.log('debug', `Poll failed for app ${key}: ${err}`)
				}
			}

			this.updateStateVariables()
			this.checkFeedbacks('compositionIsIn')
		} finally {
			this.polling = false
		}
	}

	handleConnectionError() {
		this.log('error', 'Singular.Live connection lost')
		this.updateStatus('connection_failure')
	}

	handleError(error) {
		if (error.code === 'ECONNREFUSED') {
			return this.handleConnectionError()
		} else {
			this.log('error', error.message)
			this.log('debug', error)
		}
	}
}

runEntrypoint(SingularInstance, [])

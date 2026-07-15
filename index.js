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
const numValueVarId = (appKey, node) => `num_${appKey}_${sanitize(node)}`

const UNDO_DEPTH = 10

// Config keys that require a reconnect when they change. Everything else (e.g.
// the persisted-state blob we write back) can change without re-initialising.
const CONNECTION_KEYS = ['numApps', 'pollInterval', 'apiurl']
for (let i = 0; i < MAX_APPS; i++) CONNECTION_KEYS.push(`app_${i}_name`, `app_${i}_token`)

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
		// Number-node values Companion last set, keyed by `${token}|${controlnodeId}`.
		this.numValues = new Map()
		// Pending auto-take-out timers, keyed by `${token}|${compName}`.
		this.autoOutTimers = new Map()
		// Saved scene snapshots, keyed by `${token}|${name}`.
		this.snapshots = new Map()
		// Undo history of reversible operations (most recent last), capped at UNDO_DEPTH.
		this.undoStack = []
		this.lastAction = ''
		this.pollTimer = null
		this.saveTimer = null
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

		// Hidden field used to persist module state (cycle indices, selection values,
		// snapshots) across restarts. Not shown to the user.
		fields.push({
			type: 'textinput',
			id: 'persistState',
			label: 'Persisted state',
			width: 12,
			default: '',
			isVisible: new Function('options', 'return false'),
		})

		return fields
	}

	async configUpdated(config) {
		// Only reconnect when a connection-relevant field changed. This avoids a
		// re-init loop when we write our own persisted-state blob back via saveConfig.
		const reconnect = CONNECTION_KEYS.some((key) => this.config?.[key] !== config[key])
		this.config = config

		if (reconnect) {
			this.initSingularLive(this.config)
		}
	}

	serializeState() {
		return {
			cycleState: Object.fromEntries(this.cycleState),
			selValues: Object.fromEntries(this.selValues),
			selLabels: Object.fromEntries(this.selLabels),
			numValues: Object.fromEntries(this.numValues),
			snapshots: Object.fromEntries(this.snapshots),
		}
	}

	loadPersistedState() {
		const raw = this.config?.persistState
		if (!raw) return

		try {
			const state = JSON.parse(raw)
			this.cycleState = new Map(Object.entries(state.cycleState ?? {}))
			this.selValues = new Map(Object.entries(state.selValues ?? {}))
			this.selLabels = new Map(Object.entries(state.selLabels ?? {}))
			this.numValues = new Map(Object.entries(state.numValues ?? {}))
			this.snapshots = new Map(Object.entries(state.snapshots ?? {}))
		} catch {
			this.log('warn', 'Could not parse persisted state; starting fresh')
		}
	}

	// Debounced so a burst of changes (e.g. rapid cycling) writes once.
	persist() {
		if (this.saveTimer) clearTimeout(this.saveTimer)
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null
			this.config = { ...this.config, persistState: JSON.stringify(this.serializeState()) }
			this.saveConfig(this.config)
		}, 500)
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
		const numbers = []
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
					case 'number':
						numbers.push({
							id: controlNode.id,
							label: controlNode.label,
							default: node.defaultValue,
							min: node.min,
							max: node.max,
						})
					// falls through — a number node is also a plain control/payload node
					case 'text':
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

		return { compositions, controlnodes, buttons, checkboxes, timers, selections, colors, numbers, payloadNodes }
	}

	async initSingularLive(config) {
		this.stopPolling()
		this.clearAllAutoOut()
		this.loadPersistedState()
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
		const defs = [
			{ variableId: 'last_action', name: 'Last action' },
			{ variableId: 'undo_last', name: 'Undo — next action to undo' },
		]

		for (const app of appChoices) {
			const choices = choicesByToken[app.id]
			for (const comp of choices.compositions) {
				defs.push({ variableId: compStateVarId(app.id, comp.id), name: `${app.label} / ${comp.label} — state` })
			}
			for (const sel of choices.selections) {
				defs.push({ variableId: selValueVarId(app.id, sel.id), name: `${app.label} / ${sel.label} — value (last set)` })
				defs.push({ variableId: selLabelVarId(app.id, sel.id), name: `${app.label} / ${sel.label} — label (last set)` })
			}
			for (const num of choices.numbers) {
				defs.push({ variableId: numValueVarId(app.id, num.id), name: `${app.label} / ${num.label} — value (last set)` })
			}
		}

		return defs
	}

	initVariableValues(appChoices, choicesByToken) {
		const values = {
			last_action: this.lastAction,
			undo_last: this.undoStack[this.undoStack.length - 1]?.description ?? '',
		}

		for (const app of appChoices) {
			const choices = choicesByToken[app.id]
			for (const comp of choices.compositions) {
				values[compStateVarId(app.id, comp.id)] = this.compStates.get(`${app.id}|${comp.id}`) ?? ''
			}
			for (const sel of choices.selections) {
				values[selValueVarId(app.id, sel.id)] = this.selValues.get(`${app.id}|${sel.id}`) ?? ''
				values[selLabelVarId(app.id, sel.id)] = this.selLabels.get(`${app.id}|${sel.id}`) ?? ''
			}
			for (const num of choices.numbers) {
				values[numValueVarId(app.id, num.id)] = this.numValues.get(`${app.id}|${num.id}`) ?? ''
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
		this.persist()
	}

	recordNumber(token, controlnode, value) {
		if (!token || !controlnode) return

		this.numValues.set(`${token}|${controlnode}`, value)
		this.setVariableValues({ [numValueVarId(token, controlnode)]: value })
		this.persist()
	}

	captureNumberUndo(token, controlnode) {
		const before = this.numValues.get(`${token}|${controlnode}`)
		return () => {
			if (before === undefined) return
			const conn = this.connections?.get(token)
			if (conn) conn.updateControlNode(controlnode, before)
			this.recordNumber(token, controlnode, before)
		}
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

	// Update several compositions' tracked states at once, then refresh variables
	// and feedbacks a single time (used by groups and snapshot recall).
	recordCompStatesBatch(token, stateByComp) {
		const values = {}
		for (const [comp, state] of Object.entries(stateByComp)) {
			this.compStates.set(`${token}|${comp}`, state)
			values[compStateVarId(token, comp)] = state
		}
		this.setVariableValues(values)
		this.checkFeedbacks('compositionIsIn')
	}

	// Capture the current on-air states and Companion-set selection values for an
	// app under a named snapshot.
	saveSnapshot(token, name) {
		const choices = this.choicesByToken?.[token]
		if (!token || !name || !choices) return

		const comps = {}
		for (const comp of choices.compositions) {
			comps[comp.id] = this.compStates.get(`${token}|${comp.id}`) ?? 'Out'
		}

		const sels = {}
		for (const sel of choices.selections) {
			const key = `${token}|${sel.id}`
			if (this.selValues.has(key)) {
				sels[sel.id] = { value: this.selValues.get(key), label: this.selLabels.get(key) }
			}
		}

		this.snapshots.set(`${token}|${name}`, { comps, sels })
		this.recordAction(`Save snapshot: ${name}`)
		this.persist()
	}

	async recallSnapshot(token, name, restoreSelections) {
		const conn = this.connections?.get(token)
		const snapshot = this.snapshots.get(`${token}|${name}`)
		if (!conn || !snapshot) {
			this.log('warn', `Snapshot "${name}" not found for the selected app`)
			return
		}

		const entries = Object.entries(snapshot.comps).map(([composition, state]) => ({ composition, state }))
		conn.setStates(entries)
		this.recordCompStatesBatch(token, snapshot.comps)

		if (restoreSelections) {
			for (const [node, saved] of Object.entries(snapshot.sels)) {
				conn.updateControlNode(node, saved.value)
				this.recordSelection(token, node, saved.value, saved.label)
			}
		}

		this.recordAction(`Recall snapshot: ${name}`)
	}

	pushUndo(description, undo) {
		this.undoStack.push({ description, undo })
		while (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift()
		this.setVariableValues({ undo_last: description })
	}

	async undoLast() {
		const entry = this.undoStack.pop()
		if (!entry) {
			this.log('info', 'Nothing to undo')
			return
		}

		await entry.undo()
		this.recordAction(`Undo: ${entry.description}`)
		this.setVariableValues({ undo_last: this.undoStack[this.undoStack.length - 1]?.description ?? '' })
	}

	// Each capture* reads the current state and returns a closure that restores it.
	// Call the capture BEFORE performing the action, then pushUndo() the closure.
	captureCompUndo(token, comp) {
		const before = this.compStates.get(`${token}|${comp}`) ?? 'Out'
		return () => {
			const conn = this.connections?.get(token)
			if (conn) conn.setStates([{ composition: comp, state: before }])
			this.recordCompState(token, comp, before)
		}
	}

	captureGroupUndo(token, comps) {
		const before = {}
		for (const comp of comps) before[comp] = this.compStates.get(`${token}|${comp}`) ?? 'Out'
		return () => {
			const conn = this.connections?.get(token)
			if (conn) conn.setStates(Object.entries(before).map(([composition, state]) => ({ composition, state })))
			this.recordCompStatesBatch(token, before)
		}
	}

	captureSelUndo(token, controlnode) {
		const key = `${token}|${controlnode}`
		const beforeVal = this.selValues.get(key)
		const beforeLabel = this.selLabels.get(key)
		const beforeIdx = this.cycleState.get(key)
		return () => {
			const conn = this.connections?.get(token)
			if (beforeVal !== undefined) {
				if (conn) conn.updateControlNode(controlnode, beforeVal)
				this.recordSelection(token, controlnode, beforeVal, beforeLabel)
			}
			if (beforeIdx !== undefined) this.cycleState.set(key, beforeIdx)
			else this.cycleState.delete(key)
		}
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

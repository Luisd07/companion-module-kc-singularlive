import { combineRgb } from '@companion-module/base'

import { formatLiveValue } from './lib/api.js'

function tokenField(apps) {
	return {
		type: 'dropdown',
		label: 'Control App',
		id: 'token',
		choices: apps,
		default: apps?.[0]?.id,
	}
}

// Build an isVisible function safely. Values are JSON-encoded so ids/names
// containing quotes or apostrophes can't break the generated function.
function isVisibleFor(token, extraField, extraValue) {
	const parts = [`options.token == ${JSON.stringify(token)}`]
	if (extraField !== undefined) {
		parts.push(`options[${JSON.stringify(extraField)}] == ${JSON.stringify(extraValue)}`)
	}
	return new Function('options', `return ${parts.join(' && ')}`)
}

// One composition dropdown per app, visible only for its selected app.
function perAppComp(apps, choicesByToken) {
	return apps.map((app) => {
		const choices = choicesByToken[app.id]?.compositions ?? []
		return {
			type: 'dropdown',
			label: 'Composition',
			id: `comp_${app.id}`,
			choices,
			default: choices?.[0]?.id,
			isVisible: isVisibleFor(app.id),
		}
	})
}

export function getFeedbacks(apps, choicesByToken) {
	return {
		compositionIsIn: {
			type: 'boolean',
			name: 'Composition: Is In',
			description: 'Active when the selected composition is currently on air (animated In).',
			defaultStyle: {
				bgcolor: combineRgb(0, 204, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [tokenField(apps), ...perAppComp(apps, choicesByToken)],
			callback: (feedback) => {
				const comp = feedback.options[`comp_${feedback.options.token}`]
				return this.compStates.get(`${feedback.options.token}|${comp}`) === 'In'
			},
		},
		timedTakeOutActive: {
			type: 'boolean',
			name: 'Composition: Timed Take-Out Active',
			description: 'Active while a timed auto-take-out is pending for the selected composition.',
			defaultStyle: {
				bgcolor: combineRgb(204, 102, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [tokenField(apps), ...perAppComp(apps, choicesByToken)],
			callback: (feedback) => {
				const comp = feedback.options[`comp_${feedback.options.token}`]
				return this.autoOutTimers.has(`${feedback.options.token}|${comp}`)
			},
		},
		selectionActiveValue: {
			type: 'boolean',
			name: 'Selection Node: Is Active Value (last set by Companion)',
			description:
				'Active when the value Companion last set for this node matches the chosen value. ' +
				'Tracks what Companion sent, so it goes stale if a data stream or composition script changes the value.',
			defaultStyle: {
				bgcolor: combineRgb(0, 102, 204),
				color: combineRgb(255, 255, 255),
			},
			options: [
				tokenField(apps),
				...apps.map((app) => {
					const choices = choicesByToken[app.id]?.selections ?? []
					return {
						type: 'dropdown',
						label: 'Selection Node',
						id: `controlnode_${app.id}`,
						choices,
						default: choices?.[0]?.id,
						allowCustom: false,
						isVisible: isVisibleFor(app.id),
					}
				}),
				...apps.flatMap((app) =>
					(choicesByToken[app.id]?.selections ?? []).map((selection) => ({
						type: 'dropdown',
						label: 'Value',
						id: `${app.id}__${selection.id}`,
						choices: selection.selections,
						default: selection.selections?.[0]?.id,
						isVisible: isVisibleFor(app.id, `controlnode_${app.id}`, selection.id),
					})),
				),
			],
			callback: (feedback) => {
				const token = feedback.options.token
				const controlnode = feedback.options[`controlnode_${token}`]
				const chosen = feedback.options[`${token}__${controlnode}`]
				return this.selValues.get(`${token}|${controlnode}`) === chosen
			},
		},
		selectionIsOneOf: {
			type: 'boolean',
			name: 'Selection Node: Is One Of (last set by Companion)',
			description:
				'Active when the value Companion last set for this node is one of the chosen values. ' +
				'Tracks what Companion sent, not live Singular state.',
			defaultStyle: {
				bgcolor: combineRgb(0, 102, 204),
				color: combineRgb(255, 255, 255),
			},
			options: [
				tokenField(apps),
				...apps.map((app) => {
					const choices = choicesByToken[app.id]?.selections ?? []
					return {
						type: 'dropdown',
						label: 'Selection Node',
						id: `controlnode_${app.id}`,
						choices,
						default: choices?.[0]?.id,
						allowCustom: false,
						isVisible: isVisibleFor(app.id),
					}
				}),
				...apps.flatMap((app) =>
					(choicesByToken[app.id]?.selections ?? []).map((selection) => ({
						type: 'multidropdown',
						label: 'Values',
						id: `set_${app.id}__${selection.id}`,
						choices: selection.selections,
						default: [],
						isVisible: isVisibleFor(app.id, `controlnode_${app.id}`, selection.id),
					})),
				),
			],
			callback: (feedback) => {
				const token = feedback.options.token
				const controlnode = feedback.options[`controlnode_${token}`]
				const chosen = feedback.options[`set_${token}__${controlnode}`] ?? []
				return chosen.includes(this.selValues.get(`${token}|${controlnode}`))
			},
		},
		cyclePositionIs: {
			type: 'boolean',
			name: 'Selection Node: Cycle Position Is',
			description: 'Active when a cycled selection node is currently at the given index (0-based).',
			defaultStyle: {
				bgcolor: combineRgb(0, 102, 204),
				color: combineRgb(255, 255, 255),
			},
			options: [
				tokenField(apps),
				...apps.map((app) => {
					const choices = choicesByToken[app.id]?.selections ?? []
					return {
						type: 'dropdown',
						label: 'Selection Node',
						id: `controlnode_${app.id}`,
						choices,
						default: choices?.[0]?.id,
						allowCustom: false,
						isVisible: isVisibleFor(app.id),
					}
				}),
				{ type: 'number', label: 'Index (0-based)', id: 'index', default: 0, min: 0, max: 999 },
			],
			callback: (feedback) => {
				const token = feedback.options.token
				const controlnode = feedback.options[`controlnode_${token}`]
				return this.cycleState.get(`${token}|${controlnode}`) === Number(feedback.options.index)
			},
		},
		numberThreshold: {
			type: 'boolean',
			name: 'Number Node: Threshold',
			description:
				'Active when a number node meets the comparison. Uses the value Companion last set, not live ' +
				'Singular state.',
			defaultStyle: {
				bgcolor: combineRgb(204, 102, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [
				tokenField(apps),
				...apps.map((app) => {
					const choices = choicesByToken[app.id]?.numbers ?? []
					return {
						type: 'dropdown',
						label: 'Number Node',
						id: `controlnode_${app.id}`,
						choices,
						default: choices?.[0]?.id,
						isVisible: isVisibleFor(app.id),
					}
				}),
				{
					type: 'dropdown',
					label: 'Comparison',
					id: 'op',
					choices: [
						{ id: 'ge', label: '≥' },
						{ id: 'le', label: '≤' },
						{ id: 'eq', label: '=' },
						{ id: 'gt', label: '>' },
						{ id: 'lt', label: '<' },
					],
					default: 'ge',
				},
				{ type: 'number', label: 'Value', id: 'value', default: 0, min: -1000000, max: 1000000 },
			],
			callback: (feedback) => {
				const token = feedback.options.token
				const controlnode = feedback.options[`controlnode_${token}`]
				const current = Number(this.numValues.get(`${token}|${controlnode}`))
				if (Number.isNaN(current)) return false
				const value = Number(feedback.options.value)
				switch (feedback.options.op) {
					case 'ge':
						return current >= value
					case 'le':
						return current <= value
					case 'eq':
						return current === value
					case 'gt':
						return current > value
					case 'lt':
						return current < value
					default:
						return false
				}
			},
		},
		anyCompLive: {
			type: 'boolean',
			name: 'App: Any Composition Live',
			description: 'Active when any composition in the selected app is currently on air.',
			defaultStyle: {
				bgcolor: combineRgb(0, 204, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [tokenField(apps)],
			callback: (feedback) => {
				const prefix = `${feedback.options.token}|`
				for (const [key, state] of this.compStates) {
					if (key.startsWith(prefix) && state === 'In') return true
				}
				return false
			},
		},
		apiBudget: {
			type: 'boolean',
			name: 'API: Daily Budget Above Threshold',
			description:
				"Active once the day's API consumption passes the given percentage of the configured budget. Put this " +
				'on a status button so a long or doubled-up show day is visible before polling auto-pauses.',
			defaultStyle: {
				bgcolor: combineRgb(200, 100, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [{ type: 'number', label: 'Used more than (%)', id: 'percent', default: 75, min: 1, max: 100 }],
			callback: (feedback) => {
				const budget = this.dailyBudget()
				if (!budget) return false
				return (this.apiUsage.count / budget) * 100 > Number(feedback.options.percent)
			},
		},
		pollingPaused: {
			type: 'boolean',
			name: 'API: Polling Paused',
			description:
				'Active while polling is stopped — either switched off by the Polling action or auto-paused because the ' +
				'daily budget ran low. Buttons still fire; only live feedback is frozen.',
			defaultStyle: {
				bgcolor: combineRgb(200, 0, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => this.pollingPaused(),
		},
		appConnected: {
			type: 'boolean',
			name: 'App: Connected',
			description: 'Active when the selected app has a live connection to Singular.',
			defaultStyle: {
				bgcolor: combineRgb(0, 204, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [tokenField(apps)],
			callback: (feedback) => this.connections?.has(feedback.options.token) ?? false,
		},
		syncStale: {
			type: 'boolean',
			name: 'App: Sync Stale',
			description: 'Active when the last successful poll for the app is older than the given number of seconds.',
			defaultStyle: {
				bgcolor: combineRgb(200, 0, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [
				tokenField(apps),
				{ type: 'number', label: 'Older than (seconds)', id: 'seconds', default: 10, min: 1, max: 3600 },
			],
			callback: (feedback) => {
				const status = this.appStatus?.get(feedback.options.token)
				if (!status?.lastSync) return true
				return (Date.now() - status.lastSync) / 1000 > Number(feedback.options.seconds)
			},
		},
		checkboxIsChecked: {
			type: 'boolean',
			name: 'Checkbox Node: Is Checked (live)',
			description:
				'Active when the checkbox is checked in Singular. Read live on every poll, so it stays correct when ' +
				'something other than Companion changes it.',
			defaultStyle: {
				bgcolor: combineRgb(0, 204, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [
				tokenField(apps),
				...apps.map((app) => {
					const choices = choicesByToken[app.id]?.checkboxes ?? []
					return {
						type: 'dropdown',
						label: 'Checkbox Node',
						id: `controlnode_${app.id}`,
						choices,
						default: choices?.[0]?.id,
						isVisible: isVisibleFor(app.id),
					}
				}),
				{
					type: 'checkbox',
					label: 'Active when checked (uncheck to invert)',
					id: 'expected',
					default: true,
				},
			],
			callback: (feedback) => {
				const token = feedback.options.token
				const controlnode = feedback.options[`controlnode_${token}`]
				const current = this.liveValues?.get(`${token}|${controlnode}`)
				if (current === undefined) return false
				return Boolean(current) === Boolean(feedback.options.expected)
			},
		},
		liveValueIs: {
			type: 'boolean',
			name: 'Control Node: Live Value Is',
			description:
				'Compares the live value of a control node in Singular against text. Matching is literal, so ' +
				'"contains" is usually the safest choice.',
			defaultStyle: {
				bgcolor: combineRgb(0, 102, 204),
				color: combineRgb(255, 255, 255),
			},
			options: [
				tokenField(apps),
				...apps.map((app) => {
					const choices = this.liveNodes(choicesByToken[app.id])
					return {
						type: 'dropdown',
						label: 'Control Node',
						id: `livenode_${app.id}`,
						choices,
						default: choices?.[0]?.id,
						isVisible: isVisibleFor(app.id),
					}
				}),
				{
					type: 'dropdown',
					label: 'Comparison',
					id: 'op',
					choices: [
						{ id: 'contains', label: 'contains' },
						{ id: 'eq', label: 'equals' },
						{ id: 'ne', label: 'does not equal' },
						{ id: 'notempty', label: 'is not empty' },
						{ id: 'empty', label: 'is empty (or never set)' },
					],
					default: 'contains',
				},
				{ type: 'textinput', label: 'Value', id: 'value', default: '' },
			],
			callback: (feedback) => {
				const token = feedback.options.token
				const node = feedback.options[`livenode_${token}`]
				const current = formatLiveValue(this.liveValues?.get(`${token}|${node}`))
				const expected = String(feedback.options.value ?? '')

				switch (feedback.options.op) {
					case 'contains':
						return expected !== '' && current.includes(expected)
					case 'eq':
						return current === expected
					case 'ne':
						return current !== expected
					case 'notempty':
						return current !== ''
					case 'empty':
						return current === ''
					default:
						return false
				}
			},
		},
		undoAvailable: {
			type: 'boolean',
			name: 'Undo Available',
			description: 'Active when there is an action to undo.',
			defaultStyle: {
				bgcolor: combineRgb(0, 102, 204),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => (this.undoStack?.length ?? 0) > 0,
		},
	}
}

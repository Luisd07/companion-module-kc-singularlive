function tokenField(apps) {
	return {
		type: 'dropdown',
		label: 'Control App',
		id: 'token',
		choices: apps,
		default: apps?.[0]?.id,
	}
}

// Build an isVisible function safely — values are JSON-encoded so ids/names
// containing quotes or apostrophes can't break the generated function.
function isVisibleFor(token, extraField, extraValue) {
	const parts = [`options.token == ${JSON.stringify(token)}`]
	if (extraField !== undefined) {
		parts.push(`options[${JSON.stringify(extraField)}] == ${JSON.stringify(extraValue)}`)
	}
	return new Function('options', `return ${parts.join(' && ')}`)
}

function perAppFields(apps, choicesByToken, choiceKey, label, idPrefix) {
	return apps.map((app) => {
		const choices = choicesByToken[app.id]?.[choiceKey] ?? []
		return {
			type: 'dropdown',
			label,
			id: `${idPrefix}_${app.id}`,
			choices,
			default: choices?.[0]?.id,
			isVisible: isVisibleFor(app.id),
		}
	})
}

export function getActions(apps, choicesByToken) {
	const connFor = (options) => this.connections?.get(options.token)
	const nodeFor = (options, idPrefix) => options[`${idPrefix}_${options.token}`]
	const appLabel = (token) => apps.find((a) => a.id === token)?.label ?? token
	const nodeName = (node) => (node ? node.split('&!&!&').join(' / ') : '')
	const record = (description) => this.recordAction(description)
	// Await a control call and report failure. Returns true only on success, so
	// callers can skip recording optimistic state / undo when the call failed.
	const send = async (promise, what) => {
		const res = await promise
		if (!res?.ok) {
			this.log('warn', `${what} failed${res?.status ? ` (HTTP ${res.status})` : ''}`)
			return false
		}
		return true
	}

	return {
		animateIn: {
			name: 'Take In',
			options: [tokenField(apps), ...perAppFields(apps, choicesByToken, 'compositions', 'Composition', 'comp')],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const comp = nodeFor(action.options, 'comp')
				const undo = this.captureCompUndo(action.options.token, comp)
				if (!(await send(conn.animateIn(comp), `Take In: ${comp}`))) return
				this.recordCompState(action.options.token, comp, 'In')
				this.pushUndo(`Take In: ${comp}`, undo)
				record(`Take In: ${comp}`)
			},
		},
		animateOut: {
			name: 'Take Out',
			options: [tokenField(apps), ...perAppFields(apps, choicesByToken, 'compositions', 'Composition', 'comp')],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const comp = nodeFor(action.options, 'comp')
				const undo = this.captureCompUndo(action.options.token, comp)
				if (!(await send(conn.animateOut(comp), `Take Out: ${comp}`))) return
				this.recordCompState(action.options.token, comp, 'Out')
				this.clearAutoOut(action.options.token, comp)
				this.pushUndo(`Take Out: ${comp}`, undo)
				record(`Take Out: ${comp}`)
			},
		},
		toggleComposition: {
			name: 'Toggle Take In/Out',
			options: [tokenField(apps), ...perAppFields(apps, choicesByToken, 'compositions', 'Composition', 'comp')],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const comp = nodeFor(action.options, 'comp')
				const undo = this.captureCompUndo(action.options.token, comp)
				const isIn = this.compStates.get(`${action.options.token}|${comp}`) === 'In'
				const call = isIn ? conn.animateOut(comp) : conn.animateIn(comp)
				if (!(await send(call, `Toggle: ${comp}`))) return

				this.recordCompState(action.options.token, comp, isIn ? 'Out' : 'In')
				if (isIn) this.clearAutoOut(action.options.token, comp)

				this.pushUndo(`Toggle: ${comp}`, undo)
				record(`Toggle ${isIn ? 'Out' : 'In'}: ${comp}`)
			},
		},
		takeInTimed: {
			name: 'Take In (Timed Auto Take-Out)',
			options: [
				tokenField(apps),
				...perAppFields(apps, choicesByToken, 'compositions', 'Composition', 'comp'),
				{
					type: 'number',
					label: 'Auto Take-Out after (seconds, 0 = off)',
					id: 'seconds',
					min: 0,
					max: 3600,
					default: 10,
				},
			],
			callback: async (action) => {
				if (!connFor(action.options)) return
				const comp = nodeFor(action.options, 'comp')
				const compUndo = this.captureCompUndo(action.options.token, comp)
				await this.takeInWithTimeout(action.options.token, comp, action.options.seconds)
				this.pushUndo(`Take In (timed): ${comp}`, () => {
					this.clearAutoOut(action.options.token, comp)
					compUndo()
				})
				record(`Take In (auto-out ${action.options.seconds}s): ${comp}`)
			},
		},
		updateControlNode: {
			name: 'Update Control Node',
			options: [
				tokenField(apps),
				...perAppFields(apps, choicesByToken, 'controlnodes', 'Control Node', 'controlnode'),
				{
					type: 'textinput',
					useVariables: true,
					label: 'Value',
					id: 'value',
				},
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const controlnode = nodeFor(action.options, 'controlnode')
				let parsedValue = await this.parseVariablesInString(action.options.value)
				await conn.updateControlNode(controlnode, parsedValue)
				record(`Set ${nodeName(controlnode)} = ${parsedValue}`)
			},
		},
		adjustNumberNode: {
			name: 'Adjust Number Node (±)',
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
					type: 'number',
					label: 'Step (negative to decrease)',
					id: 'step',
					default: 1,
					min: -1000000,
					max: 1000000,
				},
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const controlnode = nodeFor(action.options, 'controlnode')
				if (!controlnode) return

				const meta = (choicesByToken[action.options.token]?.numbers ?? []).find((n) => n.id === controlnode)
				const key = `${action.options.token}|${controlnode}`

				let base = Number(this.numValues.get(key))
				if (Number.isNaN(base)) base = Number(meta?.default)
				if (Number.isNaN(base)) base = 0

				let next = base + Number(action.options.step)
				next = Math.round(next * 1e6) / 1e6 // avoid float noise

				const min = meta?.min === undefined || meta.min === null || meta.min === '' ? undefined : Number(meta.min)
				const max = meta?.max === undefined || meta.max === null || meta.max === '' ? undefined : Number(meta.max)
				if (min !== undefined && !Number.isNaN(min)) next = Math.max(next, min)
				if (max !== undefined && !Number.isNaN(max)) next = Math.min(next, max)

				const undo = this.captureNumberUndo(action.options.token, controlnode)
				if (!(await send(conn.updateControlNode(controlnode, next), `Adjust ${nodeName(controlnode)}`))) return
				this.recordNumber(action.options.token, controlnode, next)
				this.pushUndo(`Adjust ${nodeName(controlnode)} → ${next}`, undo)
				record(`Adjust ${nodeName(controlnode)} → ${next}`)
			},
		},
		batchUpdatePayload: {
			name: 'Batch Update Payload Nodes',
			options: [
				tokenField(apps),
				...perAppFields(apps, choicesByToken, 'compositions', 'Composition', 'comp'),
				{
					type: 'static-text',
					id: 'payloadinfo',
					label: 'Format',
					value:
						'Enter a JSON object mapping node id to value, e.g. {"Name": "Home Team", "Score": "42"}. ' +
						'Keep values in quotes. Values support variables. The node ids for the selected composition are listed below.',
				},
				// Live hint: the available node ids for the chosen app + composition.
				...apps.flatMap((app) =>
					Object.entries(choicesByToken[app.id]?.payloadNodes ?? {})
						.filter(([, nodes]) => nodes.length)
						.map(([composition, nodes], idx) => ({
							type: 'static-text',
							id: `payloadhint_${app.id}_${idx}`,
							label: 'Node ids',
							value: nodes.map((n) => (n.title && n.title !== n.id ? `${n.id} (${n.title})` : n.id)).join(', '),
							isVisible: new Function(
								'options',
								`return options.token === ${JSON.stringify(app.id)} && options[${JSON.stringify(`comp_${app.id}`)}] === ${JSON.stringify(composition)}`,
							),
						})),
				),
				{
					type: 'textinput',
					useVariables: true,
					label: 'Payload (JSON)',
					id: 'payload',
					default: '{}',
					tooltip:
						'A JSON object mapping node id to value, e.g. {"Name": "$(custom:driver)", "Score": "42"}. ' +
						'Keep values in quotes. The whole object is sent to Singular in one call.',
				},
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return

				const parsed = await this.parseVariablesInString(action.options.payload)

				let payload
				try {
					payload = JSON.parse(parsed)
				} catch {
					this.log('warn', `Batch payload: invalid JSON after variable substitution: ${parsed}`)
					return
				}

				if (typeof payload !== 'object' || Array.isArray(payload) || payload === null) {
					this.log('warn', 'Batch payload: expected a JSON object of node id -> value')
					return
				}

				const comp = nodeFor(action.options, 'comp')
				await conn.updatePayload(comp, payload)
				record(`Batch update: ${comp}`)
			},
		},
		updateButtonNode: {
			name: 'Activate button',
			options: [tokenField(apps), ...perAppFields(apps, choicesByToken, 'buttons', 'Button', 'controlnode')],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const controlnode = nodeFor(action.options, 'controlnode')
				await conn.updateButtonNode(controlnode)
				record(`Button: ${nodeName(controlnode)}`)
			},
		},
		triggerButtonGroup: {
			name: 'Trigger Button Group',
			options: [
				tokenField(apps),
				...apps.map((app) => {
					const choices = choicesByToken[app.id]?.buttons ?? []
					return {
						type: 'multidropdown',
						label: 'Buttons',
						id: `buttons_${app.id}`,
						choices,
						default: [],
						isVisible: isVisibleFor(app.id),
					}
				}),
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const nodes = action.options[`buttons_${action.options.token}`] ?? []
				if (!nodes.length) return
				conn.pressButtons(nodes)
				record(`Button group: ${nodes.length} buttons`)
			},
		},
		updateCheckboxNode: {
			name: 'Update Checkbox Field',
			options: [
				tokenField(apps),
				...perAppFields(apps, choicesByToken, 'checkboxes', 'Control Node', 'controlnode'),
				{
					type: 'checkbox',
					label: 'Value',
					id: 'value',
				},
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const controlnode = nodeFor(action.options, 'controlnode')
				await conn.updateCheckboxNode(controlnode, action.options.value)
				record(`Set ${nodeName(controlnode)} = ${action.options.value}`)
			},
		},
		updateTimerNode: {
			name: 'Update Time Control Field',
			options: [
				tokenField(apps),
				...perAppFields(apps, choicesByToken, 'timers', 'Control Node', 'controlnode'),
				{
					type: 'dropdown',
					label: 'Action',
					id: 'value',
					choices: [
						{
							id: 'play',
							label: 'Play',
						},
						{
							id: 'pause',
							label: 'Pause',
						},
						{
							id: 'reset',
							label: 'Reset',
						},
					],
					default: 'play',
				},
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const controlnode = nodeFor(action.options, 'controlnode')
				await conn.updateTimer(controlnode, action.options.value)
				record(`Timer ${nodeName(controlnode)}: ${action.options.value}`)
			},
		},
		updateSelectionNode: {
			name: 'Update Selection Field',
			options: [
				tokenField(apps),
				...apps.map((app) => {
					const choices = choicesByToken[app.id]?.selections ?? []
					return {
						type: 'dropdown',
						label: 'Control Node',
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
						label: 'Selection',
						id: `${app.id}__${selection.id}`,
						choices: selection.selections,
						default: selection.selections?.[0]?.id,
						isVisible: isVisibleFor(app.id, `controlnode_${app.id}`, selection.id),
					})),
				),
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const controlnode = nodeFor(action.options, 'controlnode')
				const undo = this.captureSelUndo(action.options.token, controlnode)
				const value = action.options[`${action.options.token}__${controlnode}`]
				const selection = (choicesByToken[action.options.token]?.selections ?? []).find((s) => s.id === controlnode)
				const label = selection?.selections?.find((v) => v.id === value)?.label
				if (!(await send(conn.updateControlNode(controlnode, value), `Select ${nodeName(controlnode)}`))) return

				// Keep the cycle index aligned so a later Cycle continues from here
				// (e.g. a "reset to first value" button re-syncs the cycle position).
				const idx = selection?.selections?.findIndex((v) => v.id === value) ?? -1
				if (idx >= 0) this.cycleState.set(`${action.options.token}|${controlnode}`, idx)

				this.recordSelection(action.options.token, controlnode, value, label)
				this.pushUndo(`Select ${nodeName(controlnode)} = ${label ?? value}`, undo)
				record(`Select ${nodeName(controlnode)} = ${label ?? value}`)
			},
		},
		cycleSelectionNode: {
			name: 'Cycle Selection Node',
			options: [
				tokenField(apps),
				...perAppFields(apps, choicesByToken, 'selections', 'Selection Node', 'controlnode'),
				{
					type: 'dropdown',
					label: 'Direction',
					id: 'direction',
					choices: [
						{ id: '1', label: 'Next' },
						{ id: '-1', label: 'Previous' },
					],
					default: '1',
				},
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return

				const controlnode = nodeFor(action.options, 'controlnode')
				if (!controlnode) return

				const undo = this.captureSelUndo(action.options.token, controlnode)
				const selection = (choicesByToken[action.options.token]?.selections ?? []).find((s) => s.id === controlnode)
				const values = selection?.selections ?? []
				const len = values.length
				if (!len) return

				// Advance the stored index by +1 (Next) or -1 (Previous), wrapping
				// with modular arithmetic. First press starts at the first value for
				// Next and the last value for Previous.
				const step = Number(action.options.direction)
				const key = `${action.options.token}|${controlnode}`
				const start = step > 0 ? -1 : 0
				const base = this.cycleState.get(key) ?? start
				const next = (((base + step) % len) + len) % len

				if (!(await send(conn.updateControlNode(controlnode, values[next].id), `Cycle ${nodeName(controlnode)}`)))
					return
				this.cycleState.set(key, next)
				this.recordSelection(action.options.token, controlnode, values[next].id, values[next].label)
				this.pushUndo(`Cycle ${nodeName(controlnode)} → ${values[next].label ?? values[next].id}`, undo)
				record(`Cycle ${nodeName(controlnode)} → ${values[next].label ?? values[next].id}`)
			},
		},
		updateColorNode: {
			name: 'Update Color Field',
			options: [
				tokenField(apps),
				...perAppFields(apps, choicesByToken, 'colors', 'Control Node', 'controlnode'),
				{
					type: 'colorpicker',
					label: 'Value',
					id: 'value',
					enableAlpha: true,
					returnType: 'string',
					default: 'rgba(255, 255, 255, 1)',
				},
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				let color = action.options.value
				let values = color.match(/\(([^()]*)\)/g)
				let colorArray = []
				if (values[0]) {
					values[0] = values[0].replace('(', '')
					values[0] = values[0].replace(')', '')
					colorArray = values[0].split(',')
				}
				if (colorArray.length == 4) {
					let colorData = {
						r: colorArray[0],
						g: colorArray[1],
						b: colorArray[2],
						a: colorArray[3],
					}
					const controlnode = nodeFor(action.options, 'controlnode')
					await conn.updateColorNode(controlnode, colorData)
					record(`Set color ${nodeName(controlnode)}`)
				}
			},
		},
		takeOutAllOutput: {
			name: 'Take Out All Output',
			options: [tokenField(apps)],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				await conn.takeOutAllOutput()
				this.recordAllOut(action.options.token)
				record(`Take Out All: ${appLabel(action.options.token)}`)
			},
		},
		refreshComposition: {
			name: 'Refresh Composition',
			options: [tokenField(apps)],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				await conn.refreshComposition()
				record(`Refresh: ${appLabel(action.options.token)}`)
			},
		},
		triggerCompositionGroup: {
			name: 'Trigger Composition Group',
			options: [
				tokenField(apps),
				...apps.map((app) => {
					const choices = choicesByToken[app.id]?.compositions ?? []
					return {
						type: 'multidropdown',
						label: 'Compositions',
						id: `comps_${app.id}`,
						choices,
						default: [],
						isVisible: isVisibleFor(app.id),
					}
				}),
				{
					type: 'dropdown',
					label: 'Action',
					id: 'state',
					choices: [
						{ id: 'In', label: 'Take In' },
						{ id: 'Out', label: 'Take Out' },
					],
					default: 'In',
				},
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const comps = action.options[`comps_${action.options.token}`] ?? []
				if (!comps.length) return

				const undo = this.captureGroupUndo(action.options.token, comps)
				const state = action.options.state
				conn.setStates(comps.map((composition) => ({ composition, state })))

				const stateByComp = {}
				for (const comp of comps) stateByComp[comp] = state
				this.recordCompStatesBatch(action.options.token, stateByComp)

				this.pushUndo(`Group ${state === 'In' ? 'Take In' : 'Take Out'}: ${comps.length} comps`, undo)
				record(`Group ${state === 'In' ? 'Take In' : 'Take Out'}: ${comps.length} comps`)
			},
		},
		saveSnapshot: {
			name: 'Save Snapshot',
			options: [
				tokenField(apps),
				{
					type: 'textinput',
					label: 'Snapshot name',
					id: 'name',
					default: 'snapshot1',
				},
			],
			callback: async (action) => {
				this.saveSnapshot(action.options.token, action.options.name)
			},
		},
		recallSnapshot: {
			name: 'Recall Snapshot',
			options: [
				tokenField(apps),
				{
					type: 'textinput',
					label: 'Snapshot name',
					id: 'name',
					default: 'snapshot1',
				},
				{
					type: 'checkbox',
					label: 'Also restore selection values',
					id: 'restoreSelections',
					default: true,
				},
			],
			callback: async (action) => {
				await this.recallSnapshot(action.options.token, action.options.name, action.options.restoreSelections)
			},
		},
		undoLastAction: {
			name: 'Undo Last Action',
			options: [],
			callback: async () => {
				await this.undoLast()
			},
		},
		setNumberNode: {
			name: 'Set Number Node (absolute)',
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
				{ type: 'textinput', useVariables: true, label: 'Value', id: 'value', default: '0' },
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const controlnode = nodeFor(action.options, 'controlnode')
				if (!controlnode) return

				const meta = (choicesByToken[action.options.token]?.numbers ?? []).find((n) => n.id === controlnode)
				let next = Number(await this.parseVariablesInString(action.options.value))
				if (Number.isNaN(next)) {
					this.log('warn', 'Set Number: value is not a number')
					return
				}
				const min = meta?.min === undefined || meta.min === null || meta.min === '' ? undefined : Number(meta.min)
				const max = meta?.max === undefined || meta.max === null || meta.max === '' ? undefined : Number(meta.max)
				if (min !== undefined && !Number.isNaN(min)) next = Math.max(next, min)
				if (max !== undefined && !Number.isNaN(max)) next = Math.min(next, max)

				const undo = this.captureNumberUndo(action.options.token, controlnode)
				if (!(await send(conn.updateControlNode(controlnode, next), `Set ${nodeName(controlnode)}`))) return
				this.recordNumber(action.options.token, controlnode, next)
				this.pushUndo(`Set ${nodeName(controlnode)} = ${next}`, undo)
				record(`Set ${nodeName(controlnode)} = ${next}`)
			},
		},
		setSelectionValue: {
			name: 'Set Selection by Value (variable-aware)',
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
				{
					type: 'textinput',
					useVariables: true,
					label: 'Value (selection id)',
					id: 'value',
					tooltip: 'The selection value id to set. Supports variables.',
				},
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const controlnode = nodeFor(action.options, 'controlnode')
				if (!controlnode) return

				const undo = this.captureSelUndo(action.options.token, controlnode)
				const value = await this.parseVariablesInString(action.options.value)
				const selection = (choicesByToken[action.options.token]?.selections ?? []).find((s) => s.id === controlnode)
				const label = selection?.selections?.find((v) => v.id === value)?.label
				if (!(await send(conn.updateControlNode(controlnode, value), `Set ${nodeName(controlnode)}`))) return

				const idx = selection?.selections?.findIndex((v) => v.id === value) ?? -1
				if (idx >= 0) this.cycleState.set(`${action.options.token}|${controlnode}`, idx)

				this.recordSelection(action.options.token, controlnode, value, label)
				this.pushUndo(`Set ${nodeName(controlnode)} = ${label ?? value}`, undo)
				record(`Set ${nodeName(controlnode)} = ${label ?? value}`)
			},
		},
		resetSelection: {
			name: 'Reset Selection to Default',
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
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const controlnode = nodeFor(action.options, 'controlnode')
				if (!controlnode) return

				const selection = (choicesByToken[action.options.token]?.selections ?? []).find((s) => s.id === controlnode)
				const value = selection?.default ?? selection?.selections?.[0]?.id
				if (value === undefined) return
				const label = selection?.selections?.find((v) => v.id === value)?.label

				const undo = this.captureSelUndo(action.options.token, controlnode)
				if (!(await send(conn.updateControlNode(controlnode, value), `Reset ${nodeName(controlnode)}`))) return

				const idx = selection?.selections?.findIndex((v) => v.id === value) ?? -1
				if (idx >= 0) this.cycleState.set(`${action.options.token}|${controlnode}`, idx)

				this.recordSelection(action.options.token, controlnode, value, label)
				this.pushUndo(`Reset ${nodeName(controlnode)}`, undo)
				record(`Reset ${nodeName(controlnode)} = ${label ?? value}`)
			},
		},
		countdownSetStart: {
			name: 'Countdown: Set + Start',
			options: [
				tokenField(apps),
				...apps.map((app) => {
					const choices = choicesByToken[app.id]?.timers ?? []
					return {
						type: 'dropdown',
						label: 'Timer node',
						id: `timernode_${app.id}`,
						choices,
						default: choices?.[0]?.id,
						isVisible: isVisibleFor(app.id),
					}
				}),
				...apps.map((app) => {
					const choices = choicesByToken[app.id]?.numbers ?? []
					return {
						type: 'dropdown',
						label: 'Minutes node',
						id: `minnode_${app.id}`,
						choices,
						default: choices?.[0]?.id,
						isVisible: isVisibleFor(app.id),
					}
				}),
				...apps.map((app) => {
					const choices = choicesByToken[app.id]?.numbers ?? []
					return {
						type: 'dropdown',
						label: 'Seconds node',
						id: `secnode_${app.id}`,
						choices,
						default: choices?.[0]?.id,
						isVisible: isVisibleFor(app.id),
					}
				}),
				{ type: 'number', label: 'Minutes', id: 'minutes', default: 5, min: 0, max: 999 },
				{ type: 'number', label: 'Seconds', id: 'seconds', default: 0, min: 0, max: 59 },
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const timerNode = action.options[`timernode_${action.options.token}`]
				if (!timerNode) return
				const comp = timerNode.split('&!&!&')[0]
				const minNode = action.options[`minnode_${action.options.token}`]
				const secNode = action.options[`secnode_${action.options.token}`]

				const payload = {}
				if (minNode) payload[minNode.split('&!&!&')[1]] = Number(action.options.minutes)
				if (secNode) payload[secNode.split('&!&!&')[1]] = Number(action.options.seconds)
				payload[timerNode.split('&!&!&')[1]] = { command: 'play' }

				if (!(await send(conn.updatePayload(comp, payload), 'Countdown set+start'))) return
				record(`Countdown ${action.options.minutes}:${String(action.options.seconds).padStart(2, '0')} start`)
			},
		},
		rundownStep: {
			name: 'Rundown: Step',
			options: [
				tokenField(apps),
				{ type: 'textinput', label: 'Rundown name', id: 'name', default: 'rundown1' },
				...apps.map((app) => {
					const choices = choicesByToken[app.id]?.compositions ?? []
					return {
						type: 'multidropdown',
						label: 'Compositions (in order)',
						id: `comps_${app.id}`,
						choices,
						default: [],
						isVisible: isVisibleFor(app.id),
					}
				}),
				{
					type: 'dropdown',
					label: 'Direction',
					id: 'direction',
					choices: [
						{ id: '1', label: 'Next' },
						{ id: '-1', label: 'Previous' },
					],
					default: '1',
				},
			],
			callback: async (action) => {
				const comps = action.options[`comps_${action.options.token}`] ?? []
				await this.rundownStep(action.options.token, action.options.name, comps, action.options.direction)
			},
		},
		takeOutAllApps: {
			name: 'Take Out All — All Apps',
			options: [],
			callback: async () => {
				this.takeOutAllApps()
			},
		},
		reconnectControlApp: {
			name: 'Reconnect Control App',
			options: [
				{
					type: 'dropdown',
					label: 'Control App',
					id: 'token',
					choices: [{ id: '', label: 'All apps' }, ...apps],
					default: '',
				},
			],
			callback: async (action) => {
				await this.reconnectApp(action.options.token || undefined)
			},
		},
		exportSnapshots: {
			name: 'Export Snapshots (to variable + log)',
			options: [],
			callback: async () => {
				this.exportSnapshots()
			},
		},
		importSnapshots: {
			name: 'Import Snapshots (from JSON)',
			options: [{ type: 'textinput', useVariables: true, label: 'Snapshots JSON', id: 'json', default: '' }],
			callback: async (action) => {
				this.importSnapshots(await this.parseVariablesInString(action.options.json))
			},
		},
		exportActivityLog: {
			name: 'Export Activity Log (CSV)',
			options: [
				{
					type: 'textinput',
					useVariables: true,
					label: 'File path (blank = configured log file)',
					id: 'file',
					default: '',
				},
			],
			callback: async (action) => {
				this.exportActivityLog(await this.parseVariablesInString(action.options.file))
			},
		},
		clearActivityLog: {
			name: 'Clear Activity Log',
			options: [],
			callback: async () => {
				this.clearActivityLog()
			},
		},
	}
}

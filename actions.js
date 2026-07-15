function tokenField(apps) {
	return {
		type: 'dropdown',
		label: 'Control App',
		id: 'token',
		choices: apps,
		default: apps?.[0]?.id,
	}
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
			isVisible: new Function('options', `return options.token == '${app.id}'`),
		}
	})
}

export function getActions(apps, choicesByToken) {
	const connFor = (options) => this.connections?.get(options.token)
	const nodeFor = (options, idPrefix) => options[`${idPrefix}_${options.token}`]

	return {
		animateIn: {
			name: 'Animate In',
			options: [tokenField(apps), ...perAppFields(apps, choicesByToken, 'compositions', 'Composition', 'comp')],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				await conn.animateIn(nodeFor(action.options, 'comp'))
			},
		},
		animateOut: {
			name: 'Animate Out',
			options: [tokenField(apps), ...perAppFields(apps, choicesByToken, 'compositions', 'Composition', 'comp')],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				await conn.animateOut(nodeFor(action.options, 'comp'))
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
				let parsedValue = await this.parseVariablesInString(action.options.value)
				await conn.updateControlNode(nodeFor(action.options, 'controlnode'), parsedValue)
			},
		},
		batchUpdatePayload: {
			name: 'Batch Update Payload Nodes',
			options: [
				tokenField(apps),
				...perAppFields(apps, choicesByToken, 'compositions', 'Composition', 'comp'),
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

				await conn.updatePayload(nodeFor(action.options, 'comp'), payload)
			},
		},
		updateButtonNode: {
			name: 'Activate button',
			options: [tokenField(apps), ...perAppFields(apps, choicesByToken, 'buttons', 'Button', 'controlnode')],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				await conn.updateButtonNode(nodeFor(action.options, 'controlnode'))
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
				await conn.updateCheckboxNode(nodeFor(action.options, 'controlnode'), action.options.value)
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
				await conn.updateTimer(nodeFor(action.options, 'controlnode'), action.options.value)
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
						isVisible: new Function('options', `return options.token == '${app.id}'`),
					}
				}),

				...apps.flatMap((app) =>
					(choicesByToken[app.id]?.selections ?? []).map((selection) => ({
						type: 'dropdown',
						label: 'Selection',
						id: `${app.id}__${selection.id}`,
						choices: selection.selections,
						default: selection.selections?.[0]?.id,
						isVisible: new Function(
							'options',
							`return options.token == '${app.id}' && options['controlnode_${app.id}'] == '${selection.id}'`,
						),
					})),
				),
			],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				const controlnode = nodeFor(action.options, 'controlnode')
				await conn.updateControlNode(controlnode, action.options[`${action.options.token}__${controlnode}`])
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
					await conn.updateColorNode(nodeFor(action.options, 'controlnode'), colorData)
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
			},
		},
		refreshComposition: {
			name: 'Refresh Composition',
			options: [tokenField(apps)],
			callback: async (action) => {
				const conn = connFor(action.options)
				if (!conn) return
				await conn.refreshComposition()
			},
		},
	}
}

import { combineRgb } from '@companion-module/base'

function tokenField(apps) {
	return {
		type: 'dropdown',
		label: 'Control App',
		id: 'token',
		choices: apps,
		default: apps?.[0]?.id,
	}
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
			options: [
				tokenField(apps),
				...apps.map((app) => {
					const choices = choicesByToken[app.id]?.compositions ?? []
					return {
						type: 'dropdown',
						label: 'Composition',
						id: `comp_${app.id}`,
						choices,
						default: choices?.[0]?.id,
						isVisible: new Function('options', `return options.token == '${app.id}'`),
					}
				}),
			],
			callback: (feedback) => {
				const comp = feedback.options[`comp_${feedback.options.token}`]
				return this.compStates.get(`${feedback.options.token}|${comp}`) === 'In'
			},
		},
		selectionActiveValue: {
			type: 'boolean',
			name: 'Selection Node: Is Active Value (last set by Companion)',
			description:
				'Active when the value Companion last set for this selection node matches the chosen value. ' +
				'Note: this reflects what Companion set, not live Singular state — it can be stale if data streams or ' +
				'the composition JavaScript change the value.',
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
						isVisible: new Function('options', `return options.token == '${app.id}'`),
					}
				}),
				...apps.flatMap((app) =>
					(choicesByToken[app.id]?.selections ?? []).map((selection) => ({
						type: 'dropdown',
						label: 'Value',
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
			callback: (feedback) => {
				const token = feedback.options.token
				const controlnode = feedback.options[`controlnode_${token}`]
				const chosen = feedback.options[`${token}__${controlnode}`]
				return this.selValues.get(`${token}|${controlnode}`) === chosen
			},
		},
	}
}

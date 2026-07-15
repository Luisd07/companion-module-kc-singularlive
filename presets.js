import { combineRgb } from '@companion-module/base'

const BLACK = combineRgb(0, 0, 0)
const WHITE = combineRgb(255, 255, 255)
const GREEN = combineRgb(0, 204, 0)
const RED = combineRgb(200, 0, 0)
const BLUE = combineRgb(0, 102, 204)

const CATEGORY = 'KC Singular'

// Ready-made buttons wired to the first app's first comp/selection/number so
// operators can drag-and-drop instead of building each action + feedback by hand.
export function getPresets(appChoices, choicesByToken) {
	const presets = {}
	const app = appChoices?.[0]
	if (!app) return presets

	const choices = choicesByToken[app.id] || {}
	const comp = choices.compositions?.[0]
	const selection = choices.selections?.[0]
	const number = choices.numbers?.[0]

	const base = (text, bg = BLACK) => ({ text, size: '14', color: WHITE, bgcolor: bg })

	if (comp) {
		const compOpt = { token: app.id, [`comp_${app.id}`]: comp.id }
		const isInFeedback = {
			feedbackId: 'compositionIsIn',
			options: compOpt,
			style: { bgcolor: GREEN, color: BLACK },
		}

		presets['take_in'] = {
			type: 'button',
			category: CATEGORY,
			name: `Take In: ${comp.label}`,
			style: base(`IN\\n${comp.label}`),
			steps: [{ down: [{ actionId: 'animateIn', options: compOpt }], up: [] }],
			feedbacks: [isInFeedback],
		}
		presets['take_out'] = {
			type: 'button',
			category: CATEGORY,
			name: `Take Out: ${comp.label}`,
			style: base(`OUT\\n${comp.label}`),
			steps: [{ down: [{ actionId: 'animateOut', options: compOpt }], up: [] }],
			feedbacks: [],
		}
		presets['toggle'] = {
			type: 'button',
			category: CATEGORY,
			name: `Toggle: ${comp.label}`,
			style: base(comp.label),
			steps: [{ down: [{ actionId: 'toggleComposition', options: compOpt }], up: [] }],
			feedbacks: [isInFeedback],
		}
	}

	if (selection) {
		const selOpt = { token: app.id, [`controlnode_${app.id}`]: selection.id }
		presets['cycle_next'] = {
			type: 'button',
			category: CATEGORY,
			name: `Cycle Next: ${selection.label}`,
			style: base(`${selection.label}\\n▶`),
			steps: [{ down: [{ actionId: 'cycleSelectionNode', options: { ...selOpt, direction: '1' } }], up: [] }],
			feedbacks: [],
		}
		presets['cycle_prev'] = {
			type: 'button',
			category: CATEGORY,
			name: `Cycle Prev: ${selection.label}`,
			style: base(`◀\\n${selection.label}`),
			steps: [{ down: [{ actionId: 'cycleSelectionNode', options: { ...selOpt, direction: '-1' } }], up: [] }],
			feedbacks: [],
		}
	}

	if (number) {
		const numOpt = { token: app.id, [`controlnode_${app.id}`]: number.id }
		presets['number_up'] = {
			type: 'button',
			category: CATEGORY,
			name: `+1: ${number.label}`,
			style: base(`+1\\n${number.label}`),
			steps: [{ down: [{ actionId: 'adjustNumberNode', options: { ...numOpt, step: 1 } }], up: [] }],
			feedbacks: [],
		}
		presets['number_down'] = {
			type: 'button',
			category: CATEGORY,
			name: `-1: ${number.label}`,
			style: base(`-1\\n${number.label}`),
			steps: [{ down: [{ actionId: 'adjustNumberNode', options: { ...numOpt, step: -1 } }], up: [] }],
			feedbacks: [],
		}
	}

	presets['take_out_all'] = {
		type: 'button',
		category: CATEGORY,
		name: 'Take Out All (this app)',
		style: base('TAKE\\nOUT\\nALL', RED),
		steps: [{ down: [{ actionId: 'takeOutAllOutput', options: { token: app.id } }], up: [] }],
		feedbacks: [],
	}
	presets['undo'] = {
		type: 'button',
		category: CATEGORY,
		name: 'Undo Last Action',
		style: base('UNDO', BLUE),
		steps: [{ down: [{ actionId: 'undoLastAction', options: {} }], up: [] }],
		feedbacks: [{ feedbackId: 'undoAvailable', options: {}, style: { bgcolor: BLUE, color: WHITE } }],
	}

	return presets
}

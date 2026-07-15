import { InstanceBase, runEntrypoint } from '@companion-module/base'

import { getActions } from './actions.js'
import api from './lib/api.js'

const MAX_APPS = 8

class SingularInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.config = config
		this.connections = new Map()
		this.updateStatus('connecting')
		this.initSingularLive(this.config)
	}

	async destroy() {
		this.connections = new Map()
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

		for (let i = 0; i < elements.length; i++) {
			if (!elements[i].name) continue

			compositions.push({
				id: elements[i].name,
				label: elements[i].name,
			})

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
				}
			}
		}

		return { compositions, controlnodes, buttons, checkboxes, timers, selections, colors }
	}

	async initSingularLive(config) {
		this.connections = new Map()

		const apps = this.parseApps(config)
		if (apps.length === 0) {
			this.updateStatus('bad_config', 'No API URL or token configured')
			this.setActionDefinitions(getActions.bind(this)([], {}))
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

		this.setActionDefinitions(getActions.bind(this)(appChoices, choicesByToken))

		if (okCount === apps.length) {
			this.updateStatus('ok')
		} else if (okCount > 0) {
			this.updateStatus('ok', `${apps.length - okCount} of ${apps.length} apps failed to connect`)
		} else {
			this.updateStatus('connection_failure')
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

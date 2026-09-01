/// <reference path="../../pb_data/types.d.ts" />

// workshops: validate the options json on every write (including superuser
// edits from the admin UI — that's the point: editors are non-technical).
//
// Shape: [{ value: string (non-blank), imageURL: string ("" allowed; else a
// filename from the workshop's `images` field or an external URL) }]
//
// JSVM rules: handler bodies are re-evaluated standalone — no module-scope
// bindings, so the validation is inlined in both handlers.

onRecordCreateRequest((e) => {
	const raw = e.record?.getString("options") ?? ""
	if (raw && raw !== "null") {
		let parsed: unknown
		try {
			parsed = JSON.parse(raw)
		} catch {
			throw new BadRequestError("options must be valid JSON")
		}
		if (!Array.isArray(parsed)) throw new BadRequestError("options must be a JSON array")
		for (const item of parsed as { value?: unknown; imageURL?: unknown }[]) {
			if (typeof item?.value !== "string" || !/^\S(.*\S)?$/.test(item.value))
				throw new BadRequestError("every option needs a non-blank string `value`")
			if (typeof item?.imageURL !== "string" || !/^(|[\w][\w.-]*|https?:\/\/\S+)$/.test(item.imageURL))
				throw new BadRequestError(
					'every option needs a string `imageURL` ("" allowed; else a filename or URL)'
				)
		}
	}
	e.next()
}, "workshops")

onRecordUpdateRequest((e) => {
	const raw = e.record?.getString("options") ?? ""
	if (raw && raw !== "null") {
		let parsed: unknown
		try {
			parsed = JSON.parse(raw)
		} catch {
			throw new BadRequestError("options must be valid JSON")
		}
		if (!Array.isArray(parsed)) throw new BadRequestError("options must be a JSON array")
		for (const item of parsed as { value?: unknown; imageURL?: unknown }[]) {
			if (typeof item?.value !== "string" || !/^\S(.*\S)?$/.test(item.value))
				throw new BadRequestError("every option needs a non-blank string `value`")
			if (typeof item?.imageURL !== "string" || !/^(|[\w][\w.-]*|https?:\/\/\S+)$/.test(item.imageURL))
				throw new BadRequestError(
					'every option needs a string `imageURL` ("" allowed; else a filename or URL)'
				)
		}
	}
	e.next()
}, "workshops")

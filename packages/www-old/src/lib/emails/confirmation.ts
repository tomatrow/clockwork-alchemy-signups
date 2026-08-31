import Confirmation from "./Confirmation.svelte"
import { render } from "svelte-email"
import type { Workshop, SignupFormData } from "$lib/types"

export function renderConfirmation(props: {
	copy: Record<string, string>
	signup: SignupFormData
	workshops: Record<string, Workshop>
}) {
	return render({
		template: Confirmation,
		props
	})
}

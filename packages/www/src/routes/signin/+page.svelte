<script lang="ts">
	// OTP sign-in. Two steps on one page: email → code. PocketBase returns an
	// otpId even for unknown emails (enumeration protection), so a wrong
	// address just never receives a code.
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { pb } from '#lib/pocketbase/client.js';
	import { describeError } from '#lib/signup.js';

	const params = untrack(() => page.url.searchParams);
	const next = params.get('next') || '/';
	const reason = params.get('reason');

	let email = $state(params.get('email') ?? '');
	let code = $state('');
	let otpId = $state('');
	let busy = $state(false);
	let errorMessage = $state('');

	async function requestCode(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		errorMessage = '';
		try {
			const result = await pb.collection('users').requestOTP(email.trim());
			otpId = result.otpId;
		} catch (err) {
			errorMessage = describeError(err);
		} finally {
			busy = false;
		}
	}

	async function verifyCode(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		errorMessage = '';
		try {
			await pb.collection('users').authWithOTP(otpId, code.trim());
			await goto(next, { invalidateAll: true });
		} catch (err) {
			errorMessage = describeError(err);
			busy = false;
		}
	}
</script>

<h2>Sign in to update your submission</h2>

{#if reason === 'exists'}
	<p class="notice">
		<b>{email}</b> already has a submission on file. Enter the code we email you and we'll apply what
		you just filled in.
	</p>
{/if}

{#if !otpId}
	<form onsubmit={requestCode}>
		<label>
			Email
			<input type="email" bind:value={email} required autocomplete="email" />
		</label>
		<button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
	</form>
{:else}
	<form onsubmit={verifyCode}>
		<p>We sent a code to <b>{email}</b>. It expires in a few minutes.</p>
		<label>
			Code
			<input
				type="text"
				inputmode="numeric"
				autocomplete="one-time-code"
				bind:value={code}
				required
			/>
		</label>
		<button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
		<button type="button" class="secondary" onclick={() => (otpId = '')} disabled={busy}>
			Use a different email
		</button>
	</form>
{/if}

{#if errorMessage}
	<p class="notice"><b>That didn't work:</b> {errorMessage}</p>
{/if}

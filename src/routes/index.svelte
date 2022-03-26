<script>
    import { formatMoney } from "$lib/utility"
    import { slide } from "svelte/transition"

    export let title
    export let description
    export let workshops

    let checked = {}
</script>


<h1>{title}</h1>

<p>{description}</p>

<form>
    <fieldset>
        <label>
            <div>Name</div>
            <input required type="text" name="name" placeholder="your name"/>
        </label>
        <label>
            <div>Email (we'll email you a copy of your reservations)</div>
            <input required type="email" name="email" placeholder="your email" />
        </label>
    </fieldset>
    
    {#each workshops as { id, title, description, options }}
        <section>
            <h2>{title}</h2>
            <p>{description}</p>
            <fieldset>
                <input type="hidden" name={id} />
                <label>
                    <input type="checkbox" bind:checked={checked[id]} />
                    <span>Attend</span>
                </label>
                {#if checked[id]}
                    <ul transition:slide>
                        {#each options as { name, price, image }}
                            <li>
                                <label>
                                    <input required type="radio" name="option" />
                                    <span>{name}</span>
                                    -
                                    <span>{formatMoney(price)}</span>
                                </label>
                                <img {...image} />
                            </li>
                        {/each}
                    </ul>
                {/if}
            </fieldset>
        </section>
    {/each}

    <button>Submit</button>
</form>

<style lang="postcss">
    img {
        max-width: 15rem;
    }
</style>

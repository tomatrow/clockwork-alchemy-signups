import type { RequestHandler } from "@sveltejs/kit"
// import { createSessionLink } from "$lib/common/stripe"
// import type { Stripe } from "stripe"

export const post: RequestHandler<
    Locals,
    { lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] },
    { link: string }
> = async ({ body }) => {
    return {
        status: 200,
        body: {
            link: await createSessionLink(body.lineItems)
        }
    }
}

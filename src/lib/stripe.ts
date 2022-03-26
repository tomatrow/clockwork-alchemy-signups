import Stripe from "stripe"

const apiKey = process.env["STRIPE_SECRET_KEY"]
export const stripe = new Stripe(apiKey, { apiVersion: "2020-08-27" })

export async function createSessionLink(
    line_items: Stripe.Checkout.SessionCreateParams.LineItem[]
) {
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items,
        mode: "payment",
        success_url: import.meta.env.VITE_BASE_URL + "/checkout/success",
        cancel_url: import.meta.env.VITE_BASE_URL + "/checkout/cancel"
    })

    return session.url
}

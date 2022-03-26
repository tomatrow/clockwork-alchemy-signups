export function formatMoney(amount: number) {
    return new Intl.NumberFormat("en-us", {
        style: "currency",
        currency: "USD"
    }).format(amount)
}
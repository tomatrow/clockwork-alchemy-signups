const workshops = [1,2,3,4].map(id => ({
    id,
    title: "Workshop Title " + id,
    description: "A workshop description.",
    options: [
        {
            id: "beetle",
            name: "Beetle",
            price: 5.00,
            image: {
                src: "https://source.unsplash.com/1600x900/?beetle",
                alt: "beetle"
            }
        },
        {
            id: "bear",
            name: "Bear",
            price: 10.00,
            image: {
                src: "https://source.unsplash.com/1600x900/?bear",
                alt: "bear"
            }
        },
        {
            id: "battlestar",
            name: "Battlestar Galactica",
            price: 20.00,
            image: {
                src: "https://source.unsplash.com/1600x900/?starship",
                alt: "starship"
            }
        }
    ]
}))

export async function get() {
    return {
        body: {
            title: "Register for workshops taught by Catherine Johnson",
            description: "Reserve your desired options. Optional prepayment available or pay at con.",
            workshops
        }
    }
}
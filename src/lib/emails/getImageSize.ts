import sizeOf from "image-size"

export async function getImageSize(url: string) {
	try {
		const response = await fetch(url)
		const arrayBuffer = await response.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)
		return sizeOf(buffer)
	} catch (error) {
		console.error(error)
	}
}

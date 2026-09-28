/**
 * Creates a comparator function for sorting arrays by multiple criteria.
 *
 * @param measures - Functions that extract comparable values from objects.
 *                   Each measure function should consistently return the same type
 *                   (either string or number) for all items being compared.
 *
 * @returns A comparator function suitable for Array.sort()
 *
 * @example
 * ```typescript
 * const users = [
 *   { name: 'John', age: 30, score: 85 },
 *   { name: 'Jane', age: 25, score: 90 }
 * ];
 *
 * // Sort by age (ascending), then by name (ascending)
 * users.sort(byMeasures(
 *   user => user.age,
 *   user => user.name
 * ));
 *
 * // Sort by age (descending) using negative values
 * users.sort(byMeasures(user => -user.age));
 * ```
 *
 * @note
 * - String comparisons use localeCompare with numeric and case-insensitive options
 * - null/undefined values from measure functions are skipped (no comparison made)
 * - Mixing string and number returns from the same measure function may cause
 *   unexpected sorting behavior
 * - For descending order, return negative numbers or use string prefixes
 */
export function byMeasures<T>(
	...measures: Array<
		| ((value: T) => string | void | undefined | null)
		| ((value: T) => number | void | undefined | null)
	>
) {
	return (value: T, otherValue: T) => {
		for (const measure of measures) {
			const valueNorm = measure(value);
			const otherValueNorm = measure(otherValue);

			if (valueNorm == null || otherValueNorm == null) continue;

			let comparison = 0;

			if (typeof valueNorm === 'string' && typeof otherValueNorm === 'string')
				comparison = String(valueNorm).localeCompare(String(otherValueNorm), undefined, {
					numeric: true,
					sensitivity: 'base'
				});
			else if (typeof valueNorm === 'number' && typeof otherValueNorm === 'number')
				comparison = valueNorm - otherValueNorm;

			if (comparison !== 0) return comparison;
		}

		return 0;
	};
}

import { currencyForCountry } from '../lib/currency.js'

/** Vercel supplies the country header at its edge. No client country input,
 * coordinates, or raw location data is returned, stored, or logged here.
 * https://vercel.com/docs/headers/request-headers#x-vercel-ip-country
 */
export default function handler(request, response) {
  response.setHeader('Cache-Control', 'private, no-store')
  response.setHeader('Vercel-CDN-Cache-Control', 'no-store')
  const currency = currencyForCountry(request.headers['x-vercel-ip-country'])
  response.status(200).json({ currency })
}

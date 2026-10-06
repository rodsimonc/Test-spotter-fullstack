// Small gazetteer behind the fake Photon and Nominatim endpoints.
// Coordinates are real city centres, rounded to four decimals.

/** @typedef {[name: string, state: string, stateCode: string, lat: number, lon: number, population: number]} City */

/** @type {City[]} */
export const CITIES = [
  ['Dallas', 'Texas', 'TX', 32.7767, -96.797, 1304379],
  ['Houston', 'Texas', 'TX', 29.7604, -95.3698, 2304580],
  ['Austin', 'Texas', 'TX', 30.2672, -97.7431, 961855],
  ['San Antonio', 'Texas', 'TX', 29.4241, -98.4936, 1434625],
  ['Amarillo', 'Texas', 'TX', 35.222, -101.8313, 200393],
  ['Oklahoma City', 'Oklahoma', 'OK', 35.4676, -97.5164, 681054],
  ['Wichita', 'Kansas', 'KS', 37.6872, -97.3301, 397532],
  ['Kansas City', 'Missouri', 'MO', 39.0997, -94.5786, 508090],
  ['Springfield', 'Missouri', 'MO', 37.209, -93.2923, 169176],
  ['Springfield', 'Illinois', 'IL', 39.7817, -89.6501, 114394],
  ['St. Louis', 'Missouri', 'MO', 38.627, -90.1994, 301578],
  ['Memphis', 'Tennessee', 'TN', 35.1495, -90.049, 633104],
  ['Nashville', 'Tennessee', 'TN', 36.1627, -86.7816, 689447],
  ['Little Rock', 'Arkansas', 'AR', 34.7465, -92.2896, 202591],
  ['Jackson', 'Mississippi', 'MS', 32.2988, -90.1848, 153701],
  ['New Orleans', 'Louisiana', 'LA', 29.9511, -90.0715, 383997],
  ['Birmingham', 'Alabama', 'AL', 33.5186, -86.8104, 200733],
  ['Atlanta', 'Georgia', 'GA', 33.749, -84.388, 498715],
  ['Dallas', 'Georgia', 'GA', 33.9237, -84.8408, 12544],
  ['Jacksonville', 'Florida', 'FL', 30.3322, -81.6557, 949611],
  ['Miami', 'Florida', 'FL', 25.7617, -80.1918, 442241],
  ['Charlotte', 'North Carolina', 'NC', 35.2271, -80.8431, 874579],
  ['Louisville', 'Kentucky', 'KY', 38.2527, -85.7585, 633045],
  ['Indianapolis', 'Indiana', 'IN', 39.7684, -86.1581, 887642],
  ['Chicago', 'Illinois', 'IL', 41.8781, -87.6298, 2746388],
  ['Detroit', 'Michigan', 'MI', 42.3314, -83.0458, 639111],
  ['Columbus', 'Ohio', 'OH', 39.9612, -82.9988, 905748],
  ['Pittsburgh', 'Pennsylvania', 'PA', 40.4406, -79.9959, 302971],
  ['Philadelphia', 'Pennsylvania', 'PA', 39.9526, -75.1652, 1603797],
  ['New York', 'New York', 'NY', 40.7128, -74.006, 8804190],
  ['Boston', 'Massachusetts', 'MA', 42.3601, -71.0589, 675647],
  ['Portland', 'Maine', 'ME', 43.6591, -70.2568, 68408],
  ['Minneapolis', 'Minnesota', 'MN', 44.9778, -93.265, 429954],
  ['Omaha', 'Nebraska', 'NE', 41.2565, -95.9345, 486051],
  ['Kearney', 'Nebraska', 'NE', 40.6995, -99.0815, 33790],
  ['Cheyenne', 'Wyoming', 'WY', 41.14, -104.8202, 65132],
  ['Denver', 'Colorado', 'CO', 39.7392, -104.9903, 715522],
  ['Albuquerque', 'New Mexico', 'NM', 35.0844, -106.6504, 564559],
  ['Salt Lake City', 'Utah', 'UT', 40.7608, -111.891, 199723],
  ['Boise', 'Idaho', 'ID', 43.615, -116.2023, 235684],
  ['Phoenix', 'Arizona', 'AZ', 33.4484, -112.074, 1608139],
  ['Las Vegas', 'Nevada', 'NV', 36.1699, -115.1398, 641903],
  ['Los Angeles', 'California', 'CA', 34.0522, -118.2437, 3898747],
  ['Sacramento', 'California', 'CA', 38.5816, -121.4944, 524943],
  ['San Francisco', 'California', 'CA', 37.7749, -122.4194, 873965],
  ['Portland', 'Oregon', 'OR', 45.5152, -122.6784, 652503],
  ['Seattle', 'Washington', 'WA', 47.6062, -122.3321, 737015],
]

/**
 * Address-style results. Real Photon returns these for street and venue queries, with
 * `street`, `housenumber` and `city` instead of a bare place name.
 * @type {{name: string, street: string, housenumber: string, city: string, state: string,
 *   osmKey: string, osmValue: string, lat: number, lon: number}[]}
 */
export const POIS = [
  {
    name: 'Union Station',
    street: '17th Street',
    housenumber: '1701',
    city: 'Denver',
    state: 'Colorado',
    osmKey: 'railway',
    osmValue: 'station',
    lat: 39.7527,
    lon: -105.0004,
  },
  {
    name: 'Love’s Travel Stop',
    street: 'Interstate 40 Frontage Road',
    housenumber: '',
    city: 'Amarillo',
    state: 'Texas',
    osmKey: 'amenity',
    osmValue: 'fuel',
    lat: 35.1951,
    lon: -101.7452,
  },
  {
    name: 'Beale Street Landing',
    street: 'Riverside Drive',
    housenumber: '251',
    city: 'Memphis',
    state: 'Tennessee',
    osmKey: 'tourism',
    osmValue: 'attraction',
    lat: 35.1337,
    lon: -90.0728,
  },
]

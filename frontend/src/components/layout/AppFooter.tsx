export function AppFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1760px] px-4 pb-8 text-[13px] leading-relaxed text-ink-600 sm:px-6 desk:px-8 print:hidden">
      <p>
        Map data from{' '}
        <a
          className="font-medium text-teal-700 underline underline-offset-2"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap
        </a>{' '}
        contributors. Routes by OSRM. Town names from{' '}
        <a
          className="font-medium text-teal-700 underline underline-offset-2"
          href="https://www.geonames.org/"
          target="_blank"
          rel="noreferrer"
        >
          GeoNames
        </a>{' '}
        (CC BY 4.0). Plans follow the FMCSA hours-of-service rules for property-carrying drivers.
        Check them against your own records before you drive.
      </p>
    </footer>
  )
}

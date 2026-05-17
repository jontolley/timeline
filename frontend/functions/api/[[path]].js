const BACKEND = 'https://personal-timeline-api.fly.dev'

export const onRequest = async ({ request }) => {
  const url = new URL(request.url)
  const target = `${BACKEND}${url.pathname}${url.search}`
  return fetch(new Request(target, request))
}

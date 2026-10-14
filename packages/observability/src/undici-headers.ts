/** Undici auto instrumentation appends headers; remove older explicit carriers first. */
export function removeExistingPropagationHeaders(request: { headers: string | (string | string[])[] }): void {
  if (typeof request.headers === 'string') {
    request.headers = request.headers.split('\r\n').filter(line => !/^(?:traceparent|tracestate)\s*:/i.test(line)).join('\r\n');
    return;
  }
  for (let index = 0; index < request.headers.length;) {
    const name = request.headers[index];
    if (typeof name === 'string' && /^(?:traceparent|tracestate)$/i.test(name)) request.headers.splice(index, 2);
    else index += 2;
  }
}

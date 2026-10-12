// Hand a string to the browser as a file download.
export function downloadText(name: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  // Deferred: revoking synchronously can cancel the download the click just started.
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

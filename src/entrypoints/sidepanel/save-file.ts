// Saves a file through the browser's own download flow (the download folder,
// or a Save-as dialog if the viewer asked Chrome for one). It needs no
// `downloads` permission, and the file never leaves the device: the link
// points at a `blob:` URL in this page's memory.

export function saveFile(name: string, contents: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  // The download has its own copy by the time this runs out.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

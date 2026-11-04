// Reconstructed from the finite contract in CONTRACT.md, not imported from the target.
export function searchNotes(records, query) {
  const key = text => text.normalize('NFKC').toLocaleLowerCase('en-US');
  const needle = key(query);
  return records.filter(record => key(record.text).includes(needle));
}

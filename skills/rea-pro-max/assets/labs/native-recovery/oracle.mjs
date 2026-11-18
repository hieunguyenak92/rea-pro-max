// Independent recurrence from the pricing contract.
// Begin at 7 credits. Units up to 80 cost 3 each, through 176 cost 2 each,
// and additional units cost one credit. Evaluate all 256 representable inputs.
export function expectedQuotes() {
  const rows = [{ input: 0, output: 7 }];
  let output = 7;
  for (let input = 1; input < 256; input++) {
    output += input <= 80 ? 3 : input <= 176 ? 2 : 1;
    rows.push({ input, output });
  }
  return rows;
}

export function trimFill(studies){
  if(studies.length < 3) return [];

  const center = d3.median(studies, d => d.md);

  const left = studies.filter(d => d.md < center);
  const right = studies.filter(d => d.md > center);

  let missing = Math.abs(left.length - right.length);

  // if difference is 0, still fill 1 study for demo purposes
  if(missing === 0) missing = 1;

  const source = left.length > right.length ? right : left;

  // make sure we don't try to slice more than available
  const fillCount = Math.min(missing, source.length);

  const filledStudies = source.slice(0, fillCount).map(d => ({
    ...d,
    md: 2 * center - d.md,
    label: d.label + " (filled)",
    filled: true
  }));

  return filledStudies;
}
export function instrumentTransposition(label: string): number | undefined {
  if (/(?:in\s*B(?:b|♭|\b)|B[- ](?:Klarinette|Trompete))/i.test(label))
    return /tenor.*sax|sax.*tenor/i.test(label) ? -14 : -2;
  if (/(?:in\s*(?:Eb|E♭|Es)|Es[- ](?:Klarinette|Sax))/i.test(label))
    return /sax/i.test(label) ? (/bariton/i.test(label) ? -21 : -9) : 3;
  if (/(?:horn.*in\s*F|F[- ]Horn)/i.test(label)) return -7;
  if (/(?:clarinet|klarinette).*in\s*A\b/i.test(label)) return -3;
  if (
    /contrabass|kontrabass|double bass|string bass|guitar|gitarre/i.test(label)
  )
    return -12;
  if (
    /^(?:piccolo|pikkolo|ottavino|piccoloflöte)(?:\s*$|\s+flute)/i.test(label)
  )
    return 12;
  if (/(?:alto|alt).*sax|sax.*alto/i.test(label)) return -9;
  if (/tenor.*sax|sax.*tenor/i.test(label)) return -14;
  if (/bariton.*sax|sax.*bariton/i.test(label)) return -21;
  if (/soprano.*sax|sax.*soprano/i.test(label)) return -2;
  return undefined;
}

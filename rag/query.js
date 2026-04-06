export function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function getTopKMatches(queryEmbedding, storedData, k = 3) {
  const scores = storedData.map(item => {
    return {
      text: item.text,
      score: cosineSimilarity(queryEmbedding, item.embedding),
    };
  });

  scores.sort((a, b) => b.score - a.score);

  return scores.slice(0, k);
}
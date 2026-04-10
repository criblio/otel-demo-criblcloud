import { useParams } from 'react-router-dom';

export default function ComparePage() {
  const { idA, idB } = useParams();
  return (
    <div>
      <h1>Compare</h1>
      <p>{idA && idB ? `Comparing ${idA} vs ${idB}` : 'Pick two trace IDs to compare.'}</p>
    </div>
  );
}

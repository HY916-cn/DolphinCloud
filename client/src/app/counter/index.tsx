import { Redirect } from 'expo-router';

// The counter opens on deposit, its most frequent business.
export default function Counter() {
  return <Redirect href="/counter/deposit" />;
}

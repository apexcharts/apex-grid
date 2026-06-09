// Shared helpers for the demo pages. Anything that needs to be the same
// across pages — random-data generators, the User type — lives here so
// individual pages stay focused on their feature.

export type User = {
  id: number;
  name: string;
  owner: string;
  plan: (typeof PLAN_CHOICES)[number];
  status: (typeof STATUS_CHOICES)[number];
  mrr: number;
  health: number;
  trend: number[];
  age: number;
  subscribed: boolean;
  satisfaction: number;
  priority: string;
  email: string;
  avatar: string;
};

export const PRIORITY_CHOICES = ['low', 'standard', 'high'] as const;
export const PLAN_CHOICES = ['Free', 'Pro', 'Enterprise'] as const;
export const STATUS_CHOICES = ['Active', 'Trial', 'Churn'] as const;

const OWNER_NAMES = [
  'Ava Reed',
  'Liam Cho',
  'Noah Diaz',
  'Mia Wong',
  'Ethan Park',
  'Zoe Kim',
  'Lucas Hayes',
  'Ivy Chen',
] as const;

function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

function oneOf<T>(collection: readonly T[]): T {
  return collection.at(getRandomInt(collection.length)) as T;
}

function getAvatar() {
  const [type, idx] = [getRandomInt(2) % 2 ? 'women' : 'men', getRandomInt(100)];
  return `https://static.infragistics.com/xplatform/images/people/${type}/${idx}.jpg`;
}

export function generateUsers(length: number): User[] {
  return Array.from(
    { length },
    (_, idx) =>
      ({
        id: idx,
        name: `Acme Co. ${getRandomInt(length)}`,
        owner: oneOf(OWNER_NAMES),
        plan: oneOf(PLAN_CHOICES),
        status: oneOf(STATUS_CHOICES),
        mrr: (getRandomInt(480) + 20) * 10,
        health: getRandomInt(101),
        trend: Array.from({ length: 8 }, () => 20 + getRandomInt(80)),
        age: getRandomInt(100),
        subscribed: Boolean(getRandomInt(2)),
        satisfaction: getRandomInt(5),
        priority: oneOf(PRIORITY_CHOICES),
        email: `ops${idx}@acme.com`,
        avatar: getAvatar(),
      }) as User
  );
}


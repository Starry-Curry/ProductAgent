import type { Person } from "../domain.ts";
export type Friendship = {
  id: string;
  owner: Person;
  recipient: Person;
  status: "pending" | "accepted" | "declined" | "removed";
  revision: number;
  at: string;
  synthetic?: boolean;
};
export const socialProfiles: {
  id: Person;
  name: string;
  code: string;
  description: string;
}[] = [
  {
    id: "lin",
    name: "小林",
    code: "WJ-LIN",
    description: "记录喜欢的，留下值得记住的。",
  },
  {
    id: "friend",
    name: "小雨",
    code: "WJ-YU",
    description: "喜欢读书，也喜欢生活里的小东西。",
  },
  {
    id: "dad",
    name: "爸爸",
    code: "WJ-DAD",
    description: "把日子过好，东西慢慢用。",
  },
];

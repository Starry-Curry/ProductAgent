import type { State, Item, Person } from "@/lib/domain";
import type { ProductPack } from "@/lib/products";
import type { LifeIdea } from "@/lib/life/ideas";
import type { Fragment } from "@/components/life/Stories";
import type { Friendship } from "@/lib/companion/social-types";
import type {
  Preferences,
  Wish,
  GiftNote,
  EventPlan,
  SharedItem,
  SharedStory,
  Borrow,
} from "@/lib/companion/store";
export type AppData = {
  workspace: State;
  fragments: Fragment[];
  packs: ProductPack[];
  ideas: LifeIdea[];
  capabilities: {
    demonstration?: boolean;
    model: boolean;
    vision?: { ready: boolean; message: string };
    cloud: { ready: boolean; state: string; message: string };
  };
};
export type Extras = {
  friendships: Friendship[];
  preferences: Preferences;
  wishes: Wish[];
  giftNotes: GiftNote[];
  plans: EventPlan[];
  sharedItems: SharedItem[];
  sharedStories: SharedStory[];
  borrows: Borrow[];
};
export type API = (
  path: string,
  body?: unknown,
  method?: string,
) => Promise<any>;
export const names: Record<Person, string> = {
  lin: "小林",
  dad: "爸爸",
  friend: "小雨",
};
export const initials: Record<Person, string> = {
  lin: "林",
  dad: "爸",
  friend: "雨",
};
export type {
  Item,
  Person,
  Preferences,
  Wish,
  GiftNote,
  EventPlan,
  SharedItem,
  SharedStory,
  Borrow,
  Fragment,
};

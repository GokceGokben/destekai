import { render, screen } from "@testing-library/react";

import type { Customer } from "../types";
import { CustomerAvatar } from "./CustomerAvatar";

const CUSTOMER: Customer = {
  id: "CUS-1001",
  full_name: "Ayşe Yılmaz",
  email: "ayse.yilmaz@example.com",
  city: "İstanbul",
  tier: "vip",
  loyalty_points: 1840,
  member_years: 2,
  order_count: 3,
};

// The manifest is fetched once per module, so this file mocks it before any render.
vi.spyOn(globalThis, "fetch").mockResolvedValue(
  new Response(
    JSON.stringify({
      "CUS-1001": {
        url: "https://images.unsplash.com/photo-2",
        author: "Ada",
        author_url: "https://unsplash.com/@ada",
      },
    }),
  ),
);

test("a customer with a portrait shows it with credit", async () => {
  render(<CustomerAvatar customer={CUSTOMER} />);
  const image = await screen.findByRole("img", { name: "Ayşe Yılmaz" });
  expect(image).toHaveAttribute("src", "https://images.unsplash.com/photo-2");
  expect(image).toHaveAttribute("title", "Fotoğraf: Ada / Unsplash");
});

test("a customer without a portrait shows initials", () => {
  render(<CustomerAvatar customer={{ ...CUSTOMER, id: "CUS-1002", full_name: "Mehmet Demir" }} />);
  expect(screen.getByText("MD")).toBeInTheDocument();
});

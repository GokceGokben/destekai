import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Customer } from "../types";
import { LoginScreen } from "./LoginScreen";

const CUSTOMERS: Customer[] = [
  {
    id: "CUS-1001",
    full_name: "Ayşe Yılmaz",
    email: "ayse.yilmaz@example.com",
    city: "İstanbul",
    tier: "vip",
    loyalty_points: 1840,
    member_years: 2,
    order_count: 3,
  },
  {
    id: "CUS-1002",
    full_name: "Mehmet Demir",
    email: "mehmet.demir@example.com",
    city: "Ankara",
    tier: "standard",
    loyalty_points: 320,
    member_years: 1,
    order_count: 3,
  },
];

afterEach(() => vi.restoreAllMocks());

test("each customer card keeps its badge, details and login button", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ customers: CUSTOMERS })),
  );
  const onSelect = vi.fn().mockResolvedValue(undefined);
  render(<LoginScreen onSelect={onSelect} />);

  expect(await screen.findByText("Ayşe Yılmaz")).toBeInTheDocument();
  expect(screen.getByText("VIP Müşteri")).toBeInTheDocument();
  expect(screen.getByText("Standart Müşteri")).toBeInTheDocument();
  expect(screen.getByText("1.840 TP")).toBeInTheDocument();
  expect(screen.getByText("AY")).toBeInTheDocument();

  await userEvent.click(screen.getAllByRole("button", { name: /Giriş Yap/ })[1]);
  expect(onSelect).toHaveBeenCalledWith("CUS-1002");
});

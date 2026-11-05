import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "../api";
import type { Customer } from "../types";
import { DemoScreen, LoginScreen } from "./LoginScreen";

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

function demoEndpoint(enabled: boolean) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    enabled
      ? new Response(JSON.stringify({ customers: CUSTOMERS }))
      : new Response(JSON.stringify({ code: "not_found" }), { status: 404 }),
  );
}

afterEach(() => vi.restoreAllMocks());

async function fillIn(email: string, password: string) {
  await userEvent.type(screen.getByLabelText("E-posta"), email);
  await userEvent.type(screen.getByLabelText("Şifre"), password);
}

test("the customer tab signs in with email and password", async () => {
  demoEndpoint(false);
  const onLogin = vi.fn().mockResolvedValue(undefined);
  render(<LoginScreen onLogin={onLogin} />);

  await fillIn("ayse.yilmaz@example.com", "sifre");
  await userEvent.click(screen.getByRole("button", { name: "Giriş Yap" }));
  expect(onLogin).toHaveBeenCalledWith("customer", "ayse.yilmaz@example.com", "sifre");
});

test("the admin tab signs in as admin", async () => {
  demoEndpoint(false);
  const onLogin = vi.fn().mockResolvedValue(undefined);
  render(<LoginScreen onLogin={onLogin} />);

  await userEvent.click(screen.getByRole("tab", { name: "Yönetici Girişi" }));
  await fillIn("admin@destekai.local", "sifre");
  await userEvent.click(screen.getByRole("button", { name: "Yönetici Olarak Giriş Yap" }));
  expect(onLogin).toHaveBeenCalledWith("admin", "admin@destekai.local", "sifre");
});

test("a refused login explains why in Turkish", async () => {
  demoEndpoint(false);
  const onLogin = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(401, "invalid_credentials"))
    .mockRejectedValueOnce(new ApiError(429, "too_many_attempts"));
  render(<LoginScreen onLogin={onLogin} />);

  await fillIn("x@example.com", "yanlis");
  await userEvent.click(screen.getByRole("button", { name: "Giriş Yap" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("E-posta veya şifre hatalı.");

  await userEvent.click(screen.getByRole("button", { name: "Giriş Yap" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("15 dakika sonra");
});

test("the login page links to the demo page instead of showing the customers", async () => {
  demoEndpoint(true);
  render(<LoginScreen onLogin={vi.fn()} />);

  const link = await screen.findByRole("link", { name: /Demo müşterilerle dene/ });
  expect(link).toHaveAttribute("href", "#/demo");
  expect(screen.queryByText("Ayşe Yılmaz")).toBeNull();
});

test("without demo login there is no demo link", async () => {
  demoEndpoint(false);
  render(<LoginScreen onLogin={vi.fn()} />);
  await screen.findByRole("tab", { name: "Müşteri Girişi" });
  await Promise.resolve();
  expect(screen.queryByRole("link", { name: /Demo müşterilerle dene/ })).toBeNull();
});

test("the demo page lists the customers and signs one in", async () => {
  demoEndpoint(true);
  const onSelect = vi.fn().mockResolvedValue(undefined);
  render(<DemoScreen onSelect={onSelect} />);

  expect(await screen.findByText("Ayşe Yılmaz")).toBeInTheDocument();
  expect(screen.getByText("VIP Müşteri")).toBeInTheDocument();
  expect(screen.getByText("Standart Müşteri")).toBeInTheDocument();
  expect(screen.getByText("1.840 TP")).toBeInTheDocument();
  expect(screen.queryByLabelText("Şifre")).toBeNull();
  await userEvent.click(screen.getAllByRole("button", { name: /Giriş Yap/ })[1]);
  expect(onSelect).toHaveBeenCalledWith("CUS-1002");
});

test("the demo page says so when demo login is off", async () => {
  demoEndpoint(false);
  render(<DemoScreen onSelect={vi.fn()} />);
  expect(await screen.findByText(/Demo girişi kapalı/)).toBeInTheDocument();
});

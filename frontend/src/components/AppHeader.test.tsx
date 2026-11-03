import { render, screen } from "@testing-library/react";

import { AppHeader } from "./AppHeader";

test("the header marks the page being shown, and only that one", () => {
  render(<AppHeader active="Müşteri Desteği" />);

  expect(screen.getByText("Müşteri Desteği").parentElement).toHaveAttribute("aria-current", "page");
  expect(screen.getByText("Yönetici Değerlendirme & Test Paneli").parentElement).not.toHaveAttribute(
    "aria-current",
  );
});

test("the login screen marks no page and shows its own controls", () => {
  render(
    <AppHeader>
      <span>Demo Girişi</span>
    </AppHeader>,
  );

  expect(document.querySelector('[aria-current="page"]')).toBeNull();
  expect(screen.getByText("Demo Girişi")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Koyu temaya geç" })).toBeInTheDocument();
});

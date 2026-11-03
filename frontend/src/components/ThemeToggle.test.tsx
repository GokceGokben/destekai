import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThemeToggle } from "./ThemeToggle";

afterEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

test("the toggle switches the theme and remembers it", async () => {
  render(<ThemeToggle />);

  await userEvent.click(screen.getByRole("button", { name: "Koyu temaya geç" }));
  expect(document.documentElement).toHaveClass("dark");
  expect(localStorage.getItem("theme")).toBe("dark");

  await userEvent.click(screen.getByRole("button", { name: "Açık temaya geç" }));
  expect(document.documentElement).not.toHaveClass("dark");
  expect(localStorage.getItem("theme")).toBe("light");
});

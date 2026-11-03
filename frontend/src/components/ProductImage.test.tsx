import { render, screen } from "@testing-library/react";

import { ProductImage } from "./ProductImage";

const ITEM = { product_name: "Akıllı Saat", quantity: 1, unit_price_kurus: 100 };

// The manifest is fetched once per module, so this file mocks it before any render.
vi.spyOn(globalThis, "fetch").mockResolvedValue(
  new Response(
    JSON.stringify({
      "smart-watch": {
        url: "https://images.unsplash.com/photo-1",
        author: "Ada",
        author_url: "https://unsplash.com/@ada",
      },
    }),
  ),
);

test("a product with a photo shows it with credit", async () => {
  render(<ProductImage item={{ ...ITEM, image_key: "smart-watch" }} />);
  const image = await screen.findByRole("img", { name: "Akıllı Saat" });
  expect(image).toHaveAttribute("src", "https://images.unsplash.com/photo-1");
  expect(image).toHaveAttribute("title", "Fotoğraf: Ada / Unsplash");
});

test("a product without a photo shows an icon", () => {
  render(<ProductImage item={{ ...ITEM, image_key: null }} />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

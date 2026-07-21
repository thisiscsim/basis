import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Home } from "./Home";
import { useApp } from "../store";

const WS = {
  slug: "retirement",
  title: "Retirement portfolio",
  status: "active",
  holdings: 4,
  watching: 6,
  unreadAlerts: 2,
  updatedAt: "2026-07-18T00:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.mocked(window.api.listWorkspaces).mockReset().mockResolvedValue([]);
  vi.mocked(window.api.listAlbums).mockReset().mockResolvedValue([]);
});

describe("Home grid", () => {
  it("shows workspace tiles with their stats and folder tiles", async () => {
    vi.mocked(window.api.listWorkspaces).mockResolvedValue([WS]);
    vi.mocked(window.api.listAlbums).mockResolvedValue([
      { id: "family", name: "Family accounts", createdAt: "2026-07-01T00:00:00Z" },
    ]);
    useApp.setState({ view: "home", workspaces: [] });
    render(<Home />);

    expect(await screen.findByText("Retirement portfolio")).toBeInTheDocument();
    expect(screen.getByText("Family accounts")).toBeInTheDocument();
    expect(screen.getByText(/watching/)).toBeInTheDocument();
  });

  it("moves a workspace into a folder from the card menu", async () => {
    vi.mocked(window.api.listWorkspaces).mockResolvedValue([WS]);
    vi.mocked(window.api.listAlbums).mockResolvedValue([
      { id: "family", name: "Family accounts", createdAt: "2026-07-01T00:00:00Z" },
    ]);
    vi.mocked(window.api.setWorkspaceAlbum).mockResolvedValue({ ok: true });
    useApp.setState({ view: "home", workspaces: [] });
    render(<Home />);

    fireEvent.click(await screen.findByLabelText("Options for Retirement portfolio"));
    fireEvent.click(screen.getByText("Move to folder"));
    fireEvent.click(await screen.findByText("Family accounts", { selector: ".menu-item-label" }));
    await waitFor(() => expect(window.api.setWorkspaceAlbum).toHaveBeenCalledWith("retirement", "family"));
  });

  it("renames a workspace via the dialog", async () => {
    vi.mocked(window.api.listWorkspaces).mockResolvedValue([WS]);
    vi.mocked(window.api.saveMeta).mockResolvedValue({ ok: true });
    useApp.setState({ view: "home", workspaces: [] });
    render(<Home />);

    fireEvent.click(await screen.findByLabelText("Options for Retirement portfolio"));
    fireEvent.click(screen.getByText("Rename workspace"));
    const input = screen.getByDisplayValue("Retirement portfolio");
    fireEvent.change(input, { target: { value: "Long-term fund" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(window.api.saveMeta).toHaveBeenCalledWith("retirement", { title: "Long-term fund" }),
    );
  });

  it("filters tiles by search query", async () => {
    vi.mocked(window.api.listWorkspaces).mockResolvedValue([
      WS,
      { ...WS, slug: "spec", title: "Speculative plays", unreadAlerts: 0 },
    ]);
    useApp.setState({ view: "home", workspaces: [] });
    render(<Home />);

    await screen.findByText("Speculative plays");
    fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "retirement" } });
    expect(screen.getByText("Retirement portfolio")).toBeInTheDocument();
    expect(screen.queryByText("Speculative plays")).not.toBeInTheDocument();
  });

  it("shows a centered empty state on the Folders tab", async () => {
    useApp.setState({ view: "home", workspaces: [] });
    render(<Home />);
    fireEvent.click(await screen.findByRole("tab", { name: "Folders" }));
    expect(screen.getByText("No folders yet")).toBeInTheDocument();
  });
});

describe("NewWorkspaceModal", () => {
  it("creates a workspace with seeded watchlist tickers", async () => {
    vi.mocked(window.api.createWorkspace).mockResolvedValue({ ok: true, slug: "my-fund" });
    useApp.setState({ view: "home", workspaces: [] });
    render(<Home />);
    fireEvent.click(screen.getAllByText("New workspace")[0]);

    fireEvent.change(screen.getByPlaceholderText(/long-term portfolio/i), {
      target: { value: "My fund" },
    });
    fireEvent.change(screen.getByPlaceholderText("AAPL, MSFT, BFLY"), {
      target: { value: "aapl, msft" },
    });
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() =>
      expect(window.api.createWorkspace).toHaveBeenCalledWith({
        title: "My fund",
        tickers: ["AAPL", "MSFT"],
      }),
    );
    await waitFor(() => expect(useApp.getState().slug).toBe("my-fund"));
  });
});

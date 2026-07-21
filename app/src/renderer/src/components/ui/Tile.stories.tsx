import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton";
import { Menu, MenuItem } from "./Menu";
import { AlbumCover, AlbumCoverCell, NewTile, Tile, TileThumb } from "./Tile";

/** Flat-color SVG placeholder so stories don't depend on network images. */
const swatch = (hue: number): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><rect width='240' height='240' fill='hsl(${hue} 35% 72%)'/></svg>`,
  )}`;

const meta = {
  title: "UI/Tile",
  component: Tile,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={{ width: 240 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Tile>;

export default meta;
type Story = StoryObj<typeof meta>;

const actionsMenu = (
  <Menu
    className="tile-menu"
    popClassName="tile-menu-pop"
    trigger={(toggle, open) => (
      <IconButton
        icon="ellipsis"
        size={12}
        className={`tile-menu-btn ${open ? "open" : ""}`}
        label="Options"
        onClick={toggle}
      />
    )}
  >
    <MenuItem icon="input-form">Rename project</MenuItem>
    <MenuItem icon="trash-can" danger>
      Delete project
    </MenuItem>
  </Menu>
);

export const Project: Story = {
  args: {
    media: <TileThumb src={swatch(210)} />,
    title: "Tokyo trip recap",
    meta: "24.5s ⋅ 2d ago",
    actions: actionsMenu,
    onOpen: () => {},
  },
};

export const EmptyProject: Story = {
  args: {
    media: <TileThumb src={null} emptyLabel="No data yet" />,
    title: "Untitled project",
    meta: "0.0s ⋅ just now",
    actions: actionsMenu,
    onOpen: () => {},
  },
};

export const Album: Story = {
  args: {
    media: (
      <AlbumCover
        cells={[
          <AlbumCoverCell key="a" src={swatch(20)} />,
          <AlbumCoverCell key="b" src={swatch(120)} />,
          <AlbumCoverCell key="c" src={swatch(260)} />,
          <AlbumCoverCell key="d" src={swatch(320)} />,
        ]}
      />
    ),
    title: "Spring lookbook",
    meta: "4 items ⋅ 1w ago",
    actions: actionsMenu,
    onOpen: () => {},
  },
};

export const PartialAlbum: Story = {
  name: "Album (partially filled)",
  args: {
    media: <AlbumCover cells={[<AlbumCoverCell key="a" src={swatch(80)} />]} />,
    title: "New album",
    meta: "1 item ⋅ just now",
    actions: actionsMenu,
    onOpen: () => {},
  },
};

export const NewProject: Story = {
  name: "New tile",
  // Showcases the sibling NewTile component; Tile args are unused.
  args: { media: null, title: "", onOpen: () => {} },
  render: () => (
    <NewTile icon="plus-large" onClick={() => {}}>
      New workspace
    </NewTile>
  ),
};

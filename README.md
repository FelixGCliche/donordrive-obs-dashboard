Welcome to your new TanStack Start app!

# Getting Started

To run this application:

```bash
bun install
bun --bun run dev
```

# Building For Production

To build this application for production:

```bash
bun --bun run build
```

# Project structure

Code is organized by feature under `src/`. Folder names describe the feature or domain, never a technical layer (the one exception is `hooks/`).

```
src/
  assets/  components/  hooks/
  features/
    donordrive/  dock/  marks/  sandbox/  setup/  channel/
  routes/  __root.tsx  index.tsx  setup.tsx  dock.tsx  api/channel.$key.ts
  router.tsx  server.ts  styles.css  routeTree.gen.ts  cloudflare-env.d.ts
```

- `assets/`: images, downloadable files, fonts and other static files.
- `components/`: shadcn/ui primitives (`Button.tsx`, `ScrollArea.tsx`, …) plus the `cn.ts` helper. Flat, one PascalCase file per primitive, with a single `index.ts` barrel. No hooks and no `ui/` subfolder.
- `features/`: business logic and complex components. Every domain gets its own flat kebab-case folder (no subfolders inside a feature):
  - components are PascalCase `.tsx` (`DonationItem.tsx`);
  - hooks are `useX.ts`;
  - logic, schemas and constants are camelCase `.ts` (`fetchSnapshot.ts`, `protocol.ts`);
  - tests sit next to the file they test as `<file>.test.ts`;
  - fixtures go in a flat `snapshotFixtures.ts`, not a `fixtures/` folder.
- `hooks/`: shared, generic hooks (`useLocalStorage`, `useNow`). Flat, one file per hook, with a single `index.ts` barrel. Feature-specific hooks stay in their feature.
- `routes/`: file-based routing shells. Routes hold only `validateSearch`, guards and redirects, and render one feature export.
- Plumbing stays at the `src/` root: `router.tsx`, `server.ts` (the custom Worker entry), `styles.css`, `routeTree.gen.ts` (generated, never edit it) and `cloudflare-env.d.ts`.
- There are no global `lib/`, `utils/`, `schemas/`, `types/`, `api/`, `stores/` or `server/` folders.

## Imports

- Cross-folder imports use the path aliases `@assets`, `@components`, `@features`, `@hooks` and `@routes`.
- Shared folders are imported through their barrel: `import { Button } from '@components'`, `import { useNow } from '@hooks'`.
- Each `features/<name>/index.ts` barrel is that feature's public API (`export * from './X'`). Code outside a feature imports `@features/<name>`, never a file inside it.
- Within a folder, siblings import each other relatively (`./Button`), never through the barrel.

## MVP shortcuts

Known MVP shortcuts are tracked in [`docs/mvp-shortcuts.md`](docs/mvp-shortcuts.md) and marked in code with `// MVP-SHORTCUT(MVP-xx): …`. List them with `rg "MVP-SHORTCUT"`.

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Remove `@tailwindcss/vite` and `tailwindcss` from `package.json`

## Deploy to Cloudflare Workers

This project uses the Cloudflare Vite plugin (configured in `vite.config.ts`) and `wrangler.jsonc`:

1. Install Wrangler: `npm install -g wrangler`
2. Authenticate: `wrangler login`
3. Deploy: `npx wrangler deploy`

For production env vars, run `wrangler secret put MY_VAR` for each secret listed in `.env.example`. Public (non-secret) vars go in `wrangler.jsonc` under `vars`.

KV, D1, R2, and Durable Object bindings are configured in `wrangler.jsonc` — see https://developers.cloudflare.com/workers/wrangler/configuration/.

## Shadcn

Add components using the latest version of [Shadcn](https://ui.shadcn.com/).

```bash
pnpm dlx shadcn@latest add button
```

## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from '@tanstack/react-router'
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you render `{children}` in the `shellComponent`.

Here is an example layout that includes a header:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
```

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})

// Use in a component
function MyComponent() {
  const [time, setTime] = useState('')

  useEffect(() => {
    getServerTime().then(setTime)
  }, [])

  return <div>Server time: {time}</div>
}
```

## API Routes

You can create API routes by using the `server` property in your route definitions:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: () => json({ message: 'Hello, World!' }),
    },
  },
})
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).

# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).

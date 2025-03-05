import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials, req) {
        console.log("[AUTH] Login attempt:", {
          username: credentials?.username,
          requestHeaders: req.headers,
          method: req.method
        });

        if (credentials?.username === "robotpos" && credentials?.password === "123!") {
          console.log("[AUTH] Login successful for user:", credentials.username);
          return {
            id: "1",
            name: "RobotPOS Admin",
            email: "admin@robotpos.net"
          };
        }
        console.log("[AUTH] Login failed for user:", credentials?.username);
        return null;
      }
    })
  ],
  pages: {
    signIn: "/login",
  },
  debug: true, // Enable debug logs
  logger: {
    error(code, metadata) {
      console.error("[AUTH ERROR]", { code, metadata });
    },
    warn(code) {
      console.warn("[AUTH WARNING]", { code });
    },
    debug(code, metadata) {
      console.log("[AUTH DEBUG]", { code, metadata });
    },
  },
  callbacks: {
    async jwt({ token, user, account, profile, trigger }) {
      console.log("[AUTH] JWT Callback:", {
        trigger,
        hasUser: !!user,
        hasAccount: !!account,
        hasProfile: !!profile
      });

      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token, user, trigger }) {
      console.log("[AUTH] Session Callback:", {
        trigger,
        hasToken: !!token,
        hasUser: !!user,
        sessionUser: session?.user
      });

      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    }
  }
});

export { handler as GET, handler as POST };

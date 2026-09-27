package edu.ucla.phil.logic;

import java.io.File;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.stream.Stream;

/**
 * Headless start-up of the desktop program's engine, for oracle programs that record what
 * the Java code computes so the TypeScript port can be tested against it.
 *
 * init() copies data/ (the web repo's copy of the course data) into a temporary runtime
 * directory laid out like the app bundle, then runs the parts of LogicProgram.initialize
 * that need no windows: links, notation, messages, options, rules and theorems, and the
 * local-mode user. Module message catalogues are loaded with loadModuleMessages(i).
 */
public class Oracle {
   static File root;
   static final String USER_TXT = "2\nfirstName:Logic\nmidName:\nlastName:User\nstudentID:demo\nemail:\n"
      + "institution:Demo\nterm:\nclassName:\nident:\nderDigestVers:1\n";

   public static void init() throws IOException {
      Path data = Path.of(System.getProperty("oracle.data"));
      root = Files.createTempDirectory("logic-oracle").toFile();
      Path res = root.toPath().resolve("Contents/Resources");
      try (Stream<Path> files = Files.walk(data)) {
         for (Path p : (Iterable<Path>) files::iterator) {
            Path to = res.resolve(data.relativize(p).toString());
            if (Files.isDirectory(p)) Files.createDirectories(to);
            else if (!p.toString().endsWith(".pdf")) Files.copy(p, to, StandardCopyOption.REPLACE_EXISTING);
         }
      }
      Path java = root.toPath().resolve("Contents/Java");
      Files.createDirectories(java);
      Runtime.getRuntime().addShutdownHook(new Thread(() -> deleteTree(root)));

      LogicProgram.configDir = res.toFile();
      LogicProgram.linkDir = res.toFile();
      LogicProgram.progDir = java.toFile();
      LogicProgram.rootDir = root;
      LogicProgram.workDir = new File(res.toFile(), "work");
      LogicProgram.workDir.mkdirs();
      LogicProgram.userFile = new File(LogicProgram.workDir, "user.txt");
      LogicProgram.loadInfoFile = new File(java.toFile(), "loadinfo.txt");
      LogicProgram.trashDir = new File(java.toFile(), "trash");
      // the user file the desktop's local mode writes on first start (with its preferences dialog)
      Files.writeString(LogicProgram.userFile.toPath(), USER_TXT);
      LogicProgram.overrides = new OverrideSettings();
      LogicProgram.prefs = new PreferencesFile();
      LogicProgram.workPrefs = new PreferencesFile();
      FormulaParser.disableTracing();
      LogicProgram.coreInfo = LogicProgram.readCoreInfo();
      LogicProgram.links = LogicProgram.readLinks(LogicProgram.linkDir, true);
      if (LogicProgram.links == null) throw new IOException("could not read links");
      if (!Message.loadMessages()) throw new IOException("could not read messages");
      LogicProgram.resetOptions();
      LogicProgram.readOptions(LogicProgram.openDataFile("options", false));
      LogicProgram.readOptions(LogicProgram.openLocalFile("options", false));
      ServerConnection.readDatabaseLinks();
      TheoremTable theorems = TheoremTable.read(LogicProgram.openDataFile("theorems", false));
      LogicProgram.ruleTable = RuleTable.read(LogicProgram.openDataFile("rules", false), theorems);
      quiet(() -> LogicProgram.initializeUser());
   }

   /** Runs r with System.out silenced (the program prints progress chatter). */
   static void quiet(Runnable r) {
      PrintStream out = System.out;
      System.setOut(new PrintStream(PrintStream.nullOutputStream()));
      try { r.run(); } finally { System.setOut(out); }
   }

   static void deleteTree(File f) {
      File[] kids = f.listFiles();
      if (kids != null) for (File k : kids) deleteTree(k);
      f.delete();
   }

   /** Minimal JSON string quoting for oracle output. */
   public static String q(Object o) {
      if (o == null) return "null";
      String s = o.toString();
      StringBuilder b = new StringBuilder("\"");
      for (char c : s.toCharArray()) {
         switch (c) {
            case '"': b.append("\\\""); break;
            case '\\': b.append("\\\\"); break;
            case '\n': b.append("\\n"); break;
            case '\r': b.append("\\r"); break;
            case '\t': b.append("\\t"); break;
            default:
               if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
         }
      }
      return b.append('"').toString();
   }

   /** Smoke test: prints the notation, a rule count and a parsed formula. */
   public static void main(String[] args) throws Exception {
      init();
      System.out.println("syntax " + FormulaParser.syntax + ", rules " + LogicProgram.ruleTable.size()
         + ", user " + LogicProgram.user + ", parse " + LogicProgram.parseFormula("forall x (Fx -> exists y Gy)", false, false, false));
   }
}

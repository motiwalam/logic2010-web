package edu.ucla.phil.logic;

import java.io.File;
import java.io.StringReader;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.stream.Stream;

/**
 * Oracle for the engine core (src/engine/{util,data,program,problems}): data files,
 * messages, options and selectors, problem sets, work files and digests.
 *   OracleCore datafiles | codecs | messages | options | problems | work | sets | tips
 * Prints JSON on standard output.
 */
public class OracleCore {
   static StringBuilder out = new StringBuilder();

   static String q(Object o) { return Oracle.q(o); }

   static String arr(Collection<?> c) {
      StringBuilder b = new StringBuilder("[");
      boolean first = true;
      for (Object o : c) { if (!first) b.append(','); first = false; b.append(o instanceof Raw ? ((Raw) o).s : q(o)); }
      return b.append(']').toString();
   }

   static final class Raw { final String s; Raw(String s) { this.s = s; } }

   static List<String> lines(java.io.BufferedReader r) throws Exception {
      List<String> l = new ArrayList<>();
      if (r == null) return null;
      String s;
      while ((s = r.readLine()) != null) l.add(s);
      r.close();
      return l;
   }

   static Path res() { return Oracle.root.toPath().resolve("Contents/Resources"); }

   /** The internal link key of each file name (from the links table). */
   static Map<String, String> keysByFileName() {
      Map<String, String> m = new HashMap<>();
      for (Object k : LogicProgram.links.keySet()) {
         String v = (String) LogicProgram.links.get(k);
         String name = new File(v).getName();
         if (name.endsWith(".rec") || name.endsWith(".list")) m.put(name, (String) k);
      }
      return m;
   }

   public static void main(String[] args) throws Exception {
      java.io.PrintStream stdout = System.out;
      System.setOut(System.err); // the program's chatter
      Oracle.init();
      String mode = args[0];
      switch (mode) {
         case "datafiles": datafiles(); break;
         case "codecs": codecs(); break;
         case "messages": messages(); break;
         case "options": options(); break;
         case "problems": problems(); break;
         case "work": work(); break;
         case "sets": sets(); break;
         case "tips": tips(); break;
         case "local": local(); break;
         case "list": list(); break;
         default: throw new IllegalArgumentException(mode);
      }
      stdout.print(out);
      stdout.flush();
      System.exit(0);
   }

   // ---- every data file through DataFiles.open, and a scrambled copy ----
   static void datafiles() throws Exception {
      Map<String, String> keys = keysByFileName();
      List<Path> files;
      try (Stream<Path> s = Files.walk(res())) {
         files = s.filter(p -> { String n = p.toString(); return !p.startsWith(res().resolve("work")) && (n.endsWith(".rec") || n.endsWith(".list") || n.endsWith(".conf")); }).sorted().toList();
      }
      out.append("[");
      boolean first = true;
      for (Path p : files) {
         String rel = res().relativize(p).toString();
         String key = keys.get(p.getFileName().toString());
         if (rel.equals("options.rec") || rel.equals("local/options.rec")) key = "options";
         if (rel.equals("derivation-tips.rec")) key = "tips";
         if (rel.startsWith("messages/")) key = "messages";
         List<String> l = lines(DataFiles.open(p.toFile(), key, true));
         if (!first) out.append(",\n");
         first = false;
         // the legacy scrambled form of the tagged lines, and reading it back
         List<String> scrambled = new ArrayList<>();
         for (String s : l) scrambled.add(Scrambler.scramble(s));
         out.append("{\"path\":").append(q(rel)).append(",\"key\":").append(q(key)).append(",\"lines\":").append(arr(l))
            .append(",\"scrambled\":").append(arr(scrambled)).append("}");
      }
      out.append("]\n");
   }

   // ---- MD5/base64/hex/utf8/tokenizer/scrambler on generated inputs ----
   static void codecs() throws Exception {
      Random rnd = new Random(20260927);
      out.append("{\"md5\":[");
      for (int i = 0; i < 300; i++) {
         int n = i < 130 ? i : rnd.nextInt(3000);
         byte[] b = new byte[n];
         rnd.nextBytes(b);
         String hex = new HexEncoder(b).toHexString(true);
         if (i > 0) out.append(',');
         out.append("[").append(q(hex)).append(',').append(q(Scrambler.md5Hex(b))).append(',').append(q(Scrambler.md5Base64(b)))
            .append(',').append(q(new Base64Codec(b).encodeAll(false))).append(',').append(q(new HexEncoder(b).toString())).append("]");
      }
      out.append("],\"base64decode\":[");
      String alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=- \n*";
      for (int i = 0; i < 200; i++) {
         StringBuilder s = new StringBuilder();
         int n = rnd.nextInt(40);
         for (int j = 0; j < n; j++) s.append(alpha.charAt(rnd.nextInt(alpha.length())));
         if (i > 0) out.append(',');
         out.append("[").append(q(s)).append(',').append(q(new HexEncoder(new Base64Codec(s.toString()).getBytes()).toHexString(true))).append("]");
      }
      out.append("],\"utf8\":[");
      String[] texts = {"", "abc", "\u0000x", "∀x(Fx→Gx)", "é߿ࠀ￿", "😀", "Logic 2010 ∴ ⋀"};
      for (int i = 0; i < texts.length; i++) {
         if (i > 0) out.append(',');
         byte[] e = new Utf8Codec(texts[i]).encode();
         byte[] e2 = new Utf8Codec(texts[i]).encode(false);
         out.append("[").append(q(texts[i])).append(',').append(q(new HexEncoder(e).toHexString(true))).append(',')
            .append(q(new HexEncoder(e2).toHexString(true))).append(',').append(q(new Utf8Codec(e).toString())).append("]");
      }
      out.append("],\"tokenizer\":[");
      String tokAlpha = "ab\\:.;<>\" ~{},";
      String[] delims = {"\\;", "\\:.", "\\.", "\\<", "\\>", "\\\""};
      for (int i = 0; i < 300; i++) {
         StringBuilder s = new StringBuilder();
         int n = rnd.nextInt(16);
         for (int j = 0; j < n; j++) s.append(tokAlpha.charAt(rnd.nextInt(tokAlpha.length())));
         String d = delims[i % delims.length];
         boolean keep = i % 2 == 0;
         DelimitedTokenizer t = new DelimitedTokenizer(d);
         t.setInput(s.toString());
         List<Object> toks = new ArrayList<>();
         for (int k = 0; k < 20; k++) {
            String tok = t.nextToken(keep);
            toks.add(new Raw("[" + q(tok) + "," + q(String.valueOf(t.getDelimiter())) + "," + q(t.getRemaining()) + "]"));
            if (tok == null) break;
         }
         if (i > 0) out.append(',');
         out.append("{\"input\":").append(q(s)).append(",\"delims\":").append(q(d)).append(",\"keep\":").append(keep)
            .append(",\"tokens\":").append(arr(toks)).append(",\"escape\":").append(q(DelimitedTokenizer.escape(s.toString(), d)))
            .append(",\"escapeKeep\":").append(q(DelimitedTokenizer.escape(s.toString(), d, true))).append("}");
      }
      out.append("],\"scramble\":[");
      String sAlpha = "\t !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~é∀";
      for (int i = 0; i < 200; i++) {
         StringBuilder s = new StringBuilder();
         int n = rnd.nextInt(150);
         for (int j = 0; j < n; j++) s.append(sAlpha.charAt(rnd.nextInt(sAlpha.length())));
         String key = i % 3 == 0 ? "short key" : Scrambler.DEFAULT_KEY;
         if (i > 0) out.append(',');
         out.append("[").append(q(s)).append(',').append(q(key)).append(',').append(q(Scrambler.scramble(s.toString(), key)))
            .append(',').append(q(Scrambler.unscramble(s.toString(), key))).append("]");
      }
      out.append("]}\n");
   }

   // ---- message catalogues: fields, substitution, escapes, symbols, buttons ----
   static void messages() throws Exception {
      String[] links = {"messages", "derMessages", "invMessages", "parMessages", "recMessages", "symMessages", "truMessages"};
      out.append("{\"syntax\":").append(FormulaParser.getSyntax()).append(",\"catalogues\":{");
      for (int c = 0; c < links.length; c++) {
         Hashtable table = Message.parseMessages(new TaggedRecord(LogicProgram.openDataFile(links[c], false), true));
         List<String> ids = new ArrayList<>();
         for (Object k : table.keySet()) ids.add((String) k);
         Collections.sort(ids);
         if (c > 0) out.append(",\n");
         out.append(q(links[c])).append(":[");
         for (int i = 0; i < ids.size(); i++) {
            Message m = (Message) table.get(ids.get(i));
            // parameters: every <name> in the text, alternately given a value and left out
            Hashtable p1 = new Hashtable();
            java.util.regex.Matcher mt = java.util.regex.Pattern.compile("<([^<>]*)>").matcher(m.text);
            int j = 0;
            while (mt.find()) {
               String name = mt.group(1).toLowerCase();
               if (j++ % 3 != 2) p1.put(name, "V" + j + "\\nsecond " + name);
            }
            Hashtable p2 = (Hashtable) p1.clone();
            p1.put("n", "1");
            p2.put("n", " Three ");
            int[] pos = new int[m.text.length() + 1];
            for (int k = 0; k < pos.length; k++) pos[k] = k;
            String tr = LogicProgram.translateSymbols(m.text, LogicProgram.maggie, LogicProgram.symbols, pos);
            DialogHandler dh = new DialogHandler(m.buttons);
            List<String> acts = new ArrayList<>();
            for (String a : dh.actions) acts.add(a);
            if (i > 0) out.append(",\n");
            out.append("{\"key\":").append(q(ids.get(i))).append(",\"id\":").append(q(m.id)).append(",\"title\":").append(q(m.title))
               .append(",\"text\":").append(q(m.text)).append(",\"buttons\":").append(q(m.buttons)).append(",\"isError\":").append(m.isError)
               .append(",\"params1\":").append(paramsJson(p1)).append(",\"sub1\":").append(q(Message.substitute(m.text, p1)))
               .append(",\"sub2\":").append(q(Message.substitute(m.text, p2))).append(",\"subNull\":").append(q(Message.substitute(m.text, null)))
               .append(",\"expand\":").append(q(LogicProgram.expandEscapes(m.text))).append(",\"translated\":").append(q(tr))
               .append(",\"positions\":").append(Arrays.toString(pos).replace(" ", ""))
               .append(",\"labels\":").append(arr(Arrays.asList(dh.labels))).append(",\"actions\":").append(arr(acts))
               .append(",\"default\":").append(dh.defaultIndex).append("}");
         }
         out.append("]");
      }
      out.append("},\"unknown\":{\"global\":").append(msgJson(Message.get("no-such-id")));
      DerivationMessage.loadMessages();
      out.append(",\"module\":").append(msgJson(DerivationMessage.get("No-Such-Id"))).append("}}\n");
   }

   static String paramsJson(Hashtable p) {
      StringBuilder b = new StringBuilder("{");
      boolean first = true;
      List<String> keys = new ArrayList<>();
      for (Object k : p.keySet()) keys.add((String) k);
      Collections.sort(keys);
      for (String k : keys) { if (!first) b.append(','); first = false; b.append(q(k)).append(':').append(q(p.get(k))); }
      return b.append('}').toString();
   }

   static String msgJson(Message m) {
      return "{\"id\":" + q(m.id) + ",\"title\":" + q(m.title) + ",\"text\":" + q(m.text) + ",\"buttons\":" + q(m.buttons) + ",\"isError\":" + m.isError + "}";
   }

   // ---- links, logic options, module option selectors x all problem names ----
   static void options() throws Exception {
      String resPath = res().toFile().getCanonicalPath() + "/";
      String progPath = LogicProgram.progDir.getPath();
      out.append("{\"syntax\":").append(FormulaParser.getSyntax()).append(",\"links\":{");
      List<String> keys = new ArrayList<>();
      for (Object k : LogicProgram.links.keySet()) keys.add((String) k);
      Collections.sort(keys);
      boolean first = true;
      for (String k : keys) {
         String v = (String) LogicProgram.links.get(k);
         String canon = v.startsWith(resPath) ? v.substring(resPath.length()) : v.startsWith(res().toString() + "/") ? v.substring(res().toString().length() + 1) : v;
         if (canon.startsWith(progPath)) canon = "progDir" + canon.substring(progPath.length());
         if (!first) out.append(',');
         first = false;
         out.append(q(k)).append(':').append(q(canon));
      }
      out.append("},\"logic\":{\"debug\":").append(LogicProgram.debug).append(",\"printingEnabled\":").append(LogicProgram.printingEnabled)
         .append(",\"remote\":").append(LogicProgram.remote).append(",\"noNetwork\":").append(LogicProgram.noNetwork)
         .append(",\"altSymbols\":").append(LogicProgram.altSymbols).append(",\"maxBackups\":").append(LogicProgram.maxBackups)
         .append(",\"backupName\":").append(q(LogicProgram.backupName)).append(",\"restoreName\":").append(q(LogicProgram.restoreName))
         .append(",\"soloPort\":").append(LogicProgram.soloPort).append(",\"noCoreProblems\":").append(LogicProgram.noCoreProblems)
         .append(",\"hideSensitive\":").append(LogicProgram.hideSensitive)
         .append(",\"credentials\":{");
      first = true;
      List<String> ck = new ArrayList<>();
      if (LogicProgram.credentials != null) for (Object k : LogicProgram.credentials.keySet()) ck.add((String) k);
      Collections.sort(ck);
      for (String k : ck) {
         if (!first) out.append(',');
         first = false;
         out.append(q(k)).append(':').append(q(LogicProgram.credentials.get(k).toString()));
      }
      out.append("}},\n\"names\":");
      // every problem name of every module's files, both notations, plus a few made-up ones
      TreeSet<String> names = new TreeSet<>();
      try (Stream<Path> s = Files.walk(res())) {
         for (Path p : (Iterable<Path>) s::iterator) {
            String n = p.getFileName().toString();
            if (!n.endsWith("-problems.rec")) continue;
            String key = keysByFileName().get(n);
            for (String l : lines(DataFiles.open(p.toFile(), key, true))) {
               String name = TaggedRecord.nameOf(l);
               if (!TaggedRecord.isBlankOrComment(l) && name != null) names.add(name);
            }
         }
      }
      names.addAll(Arrays.asList("Deriv 1.7", "Deriv 1.72", "1.7", "Deriv 1.71", "Deriv 1.8", "", "Deriv ", "zzz", "Deriv 6.72"));
      List<String> nameList = new ArrayList<>(names);
      out.append(arr(nameList)).append(",\n\"modules\":[");
      Class[] classes = ModuleConstants.moduleClasses;
      for (int i = 0; i < classes.length; i++) {
         Class c = classes[i];
         Method reset = c.getDeclaredMethod("resetOptions");
         reset.setAccessible(true);
         reset.invoke(null);
         Method read = c.getDeclaredMethod("readOptions", java.io.Reader.class);
         read.setAccessible(true);
         read.invoke(null, LogicProgram.openDataFile("options", false));
         read.invoke(null, LogicProgram.openLocalFile("options", false));
         if (i > 0) out.append(",\n");
         out.append("{\"class\":").append(q(c.getSimpleName())).append(",\"selectors\":{");
         first = true;
         List<Field> fields = new ArrayList<>(Arrays.asList(c.getDeclaredFields()));
         fields.sort(Comparator.comparing(Field::getName));
         for (Field f : fields) {
            if (!Modifier.isStatic(f.getModifiers()) || f.getType() != ProblemSelector.class) continue;
            f.setAccessible(true);
            ProblemSelector ps = (ProblemSelector) f.get(null);
            if (!first) out.append(',');
            first = false;
            StringBuilder bits = new StringBuilder();
            for (String n : nameList) bits.append(LogicProgram.selectorMatches(ps, n) ? '1' : '0');
            bits.append(LogicProgram.selectorMatches(ps, null) ? '1' : '0');
            out.append(q(f.getName())).append(":{\"text\":").append(q(ps)).append(",\"matches\":").append(q(bits)).append('}');
         }
         out.append("},\"flags\":{");
         first = true;
         for (Field f : fields) {
            if (!Modifier.isStatic(f.getModifiers()) || f.getType() != boolean.class) continue;
            String fn = f.getName();
            if (!Arrays.asList("officialIE", "noUser", "submitExam", "printIncorrect").contains(fn)) continue;
            f.setAccessible(true);
            if (!first) out.append(',');
            first = false;
            out.append(q(fn)).append(':').append(f.getBoolean(null));
         }
         out.append("}}");
      }
      out.append("]}\n");
   }

   static final String[] STATEMENT_TAGS = {"-", "?", "=", "=", "-", "="};

   static String setJson(ProblemSet ps) {
      List<Object> entries = new ArrayList<>();
      for (int i = 0; i < ps.size(); i++) {
         ProblemEntry e = ps.getEntryAt(i);
         entries.add(new Raw("[" + q(TaggedRecord.nameOf(e.name)) + "," + e.hidden + "," + e.state + "," + e.extraProblem + "]"));
      }
      StringBuilder h = new StringBuilder("{");
      if (ps.headingsByName != null) {
         List<String> ks = new ArrayList<>();
         for (Object k : ps.headingsByName.keySet()) ks.add((String) k);
         Collections.sort(ks);
         boolean first = true;
         for (String k : ks) {
            if (!first) h.append(',');
            first = false;
            h.append(q(k)).append(':').append(arr((Vector) ps.headingsByName.get(k)));
         }
      }
      h.append('}');
      return "{\"entries\":" + arr(entries) + ",\"headings\":" + (ps.headingsByName == null ? "null" : h) + ",\"storedDigest\":" + q(ps.storedDigest) + "}";
   }

   /** A work file derived from the exercises: every 7th problem left out, every 5th statement changed, every 4th given work. */
   static String derivedWork(ProblemSet ex, int module) {
      StringBuilder b = new StringBuilder();
      for (int i = 0; i < ex.size(); i++) {
         if (i % 7 == 3) continue;
         TaggedRecord t = new TaggedRecord(ex.getRecordAt(i));
         if (i % 5 == 1) {
            int k = t.indexOfTag(STATEMENT_TAGS[module].charAt(0));
            if (k != -1) t.setValueAt(t.valueAt(k) + " ", k);
         }
         if (i % 4 == 2) t.addField(module == 0 ? '<' : module == 1 ? '#' : module == 2 ? '*' : module == 3 ? '*' : module == 4 ? '+' : '@', module == 4 ? "P:x" : "W");
         if (i % 4 == 2 && module == 0) t.addField('<', "Q");
         b.append(t).append('\n');
      }
      return b.toString();
   }

   static ProblemSet newSet(int i) throws Exception {
      Class c = Class.forName("edu.ucla.phil.logic." + new String[]{"DerivationProblemSet", "InvalidityProblemSet", "ParsingProblemSet", "RecognitionProblemSet", "SymbolizationProblemSet", "TruthProblemSet"}[i]);
      if (i == 4) { var k = c.getDeclaredConstructor(boolean.class); k.setAccessible(true); return (ProblemSet) k.newInstance(true); }
      var k = c.getDeclaredConstructor();
      k.setAccessible(true);
      return (ProblemSet) k.newInstance();
   }

   // ---- readExercises / readWork / mergeExercises / findExtraProblems for every module ----
   static void problems() throws Exception {
      out.append("{\"syntax\":").append(FormulaParser.getSyntax()).append(",\"modules\":[");
      for (int i = 0; i < 6; i++) {
         String key = ModuleConstants.moduleWorks[i];
         ProblemSet ex = LogicModule.getExercises(i, false, false, false);
         LogicModule.setStaticField(i, "exercises", ex);
         // the work of a first start: course file + local file
         ProblemSet fresh = newSet(i);
         LogicModule.readProblems(LogicProgram.openDataFile(key, false), fresh, false, false);
         ScrambledReader lr = LogicProgram.openLocalFile(key, false);
         if (lr != null) LogicModule.readProblems(lr, fresh, false, true);
         // a derived work file merged with the exercises
         String derived = derivedWork(ex, i);
         ProblemSet work = newSet(i);
         LogicModule.readProblems(new PlainRecordReader(new StringReader(derived)), work, false, false);
         String err = null;
         boolean changed = false;
         try { changed = work.mergeExercises(); } catch (Throwable t) { err = t.toString(); }
         Hashtable extra = ProblemEntry.findExtraProblems(key, work);
         List<String> extraNames = new ArrayList<>();
         for (Object k : extra.keySet()) extraNames.add((String) k);
         Collections.sort(extraNames);
         // exercises only from the local file (noCore)
         ProblemSet onlyLocal = LogicModule.getExercises(i, true, false, false);
         if (i > 0) out.append(",\n");
         out.append("{\"key\":").append(q(key)).append(",\"exercises\":").append(setJson(ex)).append(",\"fresh\":").append(setJson(fresh))
            .append(",\"derived\":").append(q(derived)).append(",\"merged\":").append(setJson(work)).append(",\"changed\":").append(changed)
            .append(",\"mergeError\":").append(q(err)).append(",\"extra\":").append(arr(extraNames))
            .append(",\"onlyLocal\":").append(setJson(onlyLocal)).append("}");
      }
      out.append("]}\n");
   }

   // ---- writing work files and digests ----
   static void work() throws Exception {
      out.append("{\"syntax\":").append(FormulaParser.getSyntax()).append(",\"modules\":[");
      File workDir = LogicProgram.workDir;
      for (int i = 0; i < 6; i++) {
         String key = ModuleConstants.moduleWorks[i];
         ProblemSet ex = LogicModule.getExercises(i, false, false, false);
         String userBefore = Files.readString(LogicProgram.userFile.toPath());
         LogicModule.writeProblems(ex, key);
         String text = Files.readString(new File(workDir, DataFiles.workFileName(key)).toPath(), StandardCharsets.UTF_8);
         // derived work (legacy lines) saved in the readable format
         ProblemSet work = newSet(i);
         LogicModule.readProblems(new PlainRecordReader(new StringReader(derivedWork(ex, i))), work, false, false);
         LogicModule.writeProblems(work, key);
         String text2 = Files.readString(new File(workDir, DataFiles.workFileName(key)).toPath(), StandardCharsets.UTF_8);
         // read back as the module does, and verify its digest
         ProblemSet back = newSet(i);
         LogicModule.readProblems(DataFiles.openWork(workDir, key), back, false, false);
         String computed = back.computeDigest(LogicProgram.user);
         if (i > 0) out.append(",\n");
         out.append("{\"key\":").append(q(key)).append(",\"exercisesFile\":").append(q(text)).append(",\"workFile\":").append(q(text2))
            .append(",\"readBack\":").append(setJson(back)).append(",\"computed\":").append(q(computed))
            .append(",\"legacy\":").append(q(new String(DataFiles.legacyWorkBytes(workDir, key), StandardCharsets.UTF_8)))
            .append(",\"userDigestVers\":").append(q(LogicProgram.user.get(ProblemSetDigestKey(i)))).append("}");
         new File(workDir, DataFiles.workFileName(key)).delete();
      }
      out.append("],\"student\":");
      // the real student work in the desktop's runtime directory
      Path student = Path.of(System.getProperty("oracle.student"));
      String original = Files.readString(student, StandardCharsets.UTF_8);
      Files.writeString(new File(workDir, "derivation.rec").toPath(), original, StandardCharsets.UTF_8);
      ProblemSet s = newSet(0);
      LogicModule.readProblems(DataFiles.openWork(workDir, "derwork.txt"), s, false, false);
      String computed = s.computeDigest(LogicProgram.user);
      LogicModule.writeProblems(s, "derwork.txt");
      String rewritten = Files.readString(new File(workDir, "derivation.rec").toPath(), StandardCharsets.UTF_8);
      // a hand-edited copy must fail the check
      String edited = original.replaceFirst("seconds: 8", "seconds: 9");
      Files.writeString(new File(workDir, "derivation.rec").toPath(), edited, StandardCharsets.UTF_8);
      ProblemSet e = newSet(0);
      LogicModule.readProblems(DataFiles.openWork(workDir, "derwork.txt"), e, false, false);
      out.append("{\"original\":").append(q(original)).append(",\"stored\":").append(q(s.storedDigest)).append(",\"computed\":").append(q(computed))
         .append(",\"rewritten\":").append(q(rewritten)).append(",\"names\":").append(setJson(s))
         .append(",\"editedStored\":").append(q(e.storedDigest)).append(",\"editedComputed\":").append(q(e.computeDigest(LogicProgram.user)))
         .append(",\"nullVersion\":").append(q(LogicProgram.user.computeDigest(new ProblemRecordEnumeration(s), null)))
         .append("}}\n");
   }

   static String ProblemSetDigestKey(int i) {
      return (String) LogicModule.getStaticField(i, "digestVersKey");
   }

   // ---- ProblemSelector and IntervalSet operations on generated sets ----
   static void sets() throws Exception {
      Random rnd = new Random(77);
      String[] pool = {"1.7", "1.72", "Deriv 1.7", "a", "b", "b1", "c", "", "zz", "1.10", "1.9", "\\\"q"};
      out.append("{\"selectors\":[");
      for (int i = 0; i < 400; i++) {
         String a = randomSelector(rnd, pool), b = randomSelector(rnd, pool);
         String op = new String[]{"union", "intersect", "subtract"}[i % 3];
         ProblemSelector pa = new ProblemSelector(a), pb = new ProblemSelector(b);
         String sa = pa.toString(), sb = pb.toString();
         ProblemSelector r = op.equals("union") ? pa.union(pb) : op.equals("intersect") ? pa.intersect(pb) : pa.subtract(pb);
         StringBuilder bits = new StringBuilder();
         for (String n : pool) bits.append(r.contains(n) ? '1' : '0');
         for (char f : "uvx".toCharArray()) bits.append(r.hasFlag(f) ? '1' : '0');
         if (i > 0) out.append(',');
         out.append("[").append(q(a)).append(',').append(q(b)).append(',').append(q(op)).append(',').append(q(sa)).append(',').append(q(sb))
            .append(',').append(q(r)).append(',').append(q(bits)).append(',').append(r.isEmpty()).append(',').append(r.hashCode())
            .append(',').append(new ProblemSelector(a).equals(new ProblemSelector(b))).append("]");
      }
      out.append("],\"pool\":").append(arr(Arrays.asList(pool))).append(",\"intervals\":[");
      for (int i = 0; i < 400; i++) {
         String a = randomInterval(rnd), b = randomInterval(rnd);
         String op = new String[]{"union", "intersect", "subtract"}[i % 3];
         IntervalSet pa = new IntervalSet(a), pb = new IntervalSet(b);
         IntervalSet r = op.equals("union") ? pa.union(pb) : op.equals("intersect") ? pa.intersect(pb) : pa.subtract(pb);
         StringBuilder bits = new StringBuilder();
         for (int n = -2; n < 14; n++) bits.append(r.contains(n) ? '1' : '0');
         List<Object> el = new ArrayList<>();
         Enumeration en = r.elements();
         int guard = 0;
         while (en.hasMoreElements() && guard++ < 40) el.add(new Raw(String.valueOf(en.nextElement())));
         if (i > 0) out.append(',');
         out.append("[").append(q(a)).append(',').append(q(b)).append(',').append(q(op)).append(',').append(q(r)).append(',').append(q(bits))
            .append(',').append(arr(el)).append(',').append(q(r.selectChars("abcdefghijkl"))).append(',').append(r.hashCode()).append("]");
      }
      out.append("]}\n");
   }

   static String randomSelector(Random rnd, String[] pool) {
      StringBuilder s = new StringBuilder();
      if (rnd.nextInt(3) == 0) s.append('~');
      if (rnd.nextInt(3) == 0) s.append('u');
      if (rnd.nextInt(5) == 0) s.append("vu");
      s.append('{');
      int n = rnd.nextInt(5);
      for (int i = 0; i < n; i++) {
         if (i > 0) s.append(',');
         if (rnd.nextInt(3) == 0) s.append('~');
         s.append('"').append(pool[rnd.nextInt(pool.length)]).append('"');
      }
      return s.append('}').toString();
   }

   static String randomInterval(Random rnd) {
      StringBuilder s = new StringBuilder();
      if (rnd.nextInt(3) == 0) s.append('~');
      s.append('{');
      int n = rnd.nextInt(5);
      for (int i = 0; i < n; i++) { if (i > 0) s.append(','); s.append(rnd.nextInt(12)); }
      return s.append('}').toString();
   }

   // ---- the derivation tips outline ----
   static void tips() throws Exception {
      OutlineNode root = OutlineNode.readOutline(LogicProgram.openDataFile("tips", false), 20);
      out.append(nodeJson(root)).append('\n');
   }

   static String nodeJson(OutlineNode n) {
      List<Object> kids = new ArrayList<>();
      for (java.awt.Component c : n.getComponents()) if (c instanceof OutlineNode) kids.add(new Raw(nodeJson((OutlineNode) c)));
      return "{\"title\":" + q(n.entry.titleLabel.getName()) + ",\"text\":" + q(n.entry.textArea.getText()) + ",\"expanded\":" + n.isExpanded()
         + ",\"children\":" + arr(kids) + "}";
   }

   // ---- local problem files: sorted insertion, duplicates, readExercises with and without core ----
   static void local() throws Exception {
      out.append("{\"syntax\":").append(FormulaParser.getSyntax()).append(",\"modules\":[");
      String[] files = {"derivation-problems.rec", "invalidity-problems.rec", "parsing-problems.rec", "recognition-problems.rec", "symbolization-problems.rec", "truth-table-problems.rec"};
      for (int i = 0; i < 6; i++) {
         String key = ModuleConstants.moduleWorks[i];
         String schema = DataFiles.schemaForKey(key);
         ProblemSet ex = LogicModule.getExercises(i, false, false, false);
         StringBuffer text = new StringBuffer("# local problems\n");
         for (int j = 0; j < ex.size(); j += 9) {
            TaggedRecord t = new TaggedRecord(ex.getRecordAt(j));
            String name = t.getName();
            // a new problem; one with a course problem's name; and a duplicate of the new one
            String[] names = {"Local " + (100 - j) + "." + name.length(), name, "Local " + (100 - j) + "." + name.length(), "x.Z " + j};
            String n = names[j / 9 % names.length];
            t.setName(n);
            if (j % 2 == 0) text.append("## heading for ").append(n).append('\n');
            text.append('\n');
            DataFiles.writeRecord(text, t, schema);
         }
         Path localFile = res().resolve("local").resolve(files[i]);
         Files.writeString(localFile, text.toString(), StandardCharsets.UTF_8);
         ProblemSet ex2 = LogicModule.getExercises(i, false, false, false);
         ProblemSet onlyLocal = LogicModule.getExercises(i, true, false, false);
         ProblemSet fresh = newSet(i);
         LogicModule.readProblems(LogicProgram.openDataFile(key, false), fresh, false, false);
         LogicModule.readProblems(LogicProgram.openLocalFile(key, false), fresh, false, true);
         Hashtable extra = ProblemEntry.findExtraProblems(key, fresh);
         List<String> extraNames = new ArrayList<>();
         for (Object k : extra.keySet()) extraNames.add((String) k);
         Collections.sort(extraNames);
         if (i > 0) out.append(",\n");
         out.append("{\"key\":").append(q(key)).append(",\"file\":").append(q("local/" + files[i])).append(",\"text\":").append(q(text))
            .append(",\"exercises\":").append(setJson(ex2)).append(",\"onlyLocal\":").append(setJson(onlyLocal))
            .append(",\"fresh\":").append(setJson(fresh)).append(",\"extra\":").append(arr(extraNames)).append("}");
      }
      out.append("]}\n");
   }

   // ---- the derivation problem list and its search ----
   static void list() throws Exception {
      DerivationProblemSet ex = (DerivationProblemSet) LogicModule.getExercises(0, false, false, false);
      LPDerivation.exercises = ex;
      DerivationProblemSet work = (DerivationProblemSet) newSet(0);
      Path student = Path.of(System.getProperty("oracle.student"));
      Files.writeString(new File(LogicProgram.workDir, "derivation.rec").toPath(), Files.readString(student, StandardCharsets.UTF_8), StandardCharsets.UTF_8);
      LogicModule.readProblems(DataFiles.openWork(LogicProgram.workDir, "derwork.txt"), work, false, false);
      work.mergeExercises();
      // some states, some hidden problems
      for (int i = 0; i < work.size(); i++) {
         ProblemEntry e = work.getEntryAt(i);
         e.state = i % 5;
         if (i % 97 == 5) e.hidden = true;
      }
      Method reset = LPDerivation.class.getDeclaredMethod("resetOptions");
      reset.invoke(null);
      LPDerivation.readOptions(LogicProgram.openDataFile("options", false));
      ProblemSelector restrict = new ProblemSelector("{\"Deriv 1.7\",~\"Deriv 2.1\"}");
      ProblemSelector exclude = new ProblemSelector("{\"Deriv 3.0\",\"Deriv 3.1\"}");
      String[] queries = {"", "t2", "mc1", "MC1 T2", "dist", "1.7", "deriv 1.", "proves", "t", "zzz", "  t25  ", "ssimp5", "ur", "eg"};
      out.append("{\"notes\":[");
      for (int i = 0; i < work.size(); i++) {
         if (i > 0) out.append(',');
         out.append(q(work.getSearchNote(new TaggedRecord(work.getRecordAt(i)))));
      }
      out.append("],\"work\":").append(setJson(work)).append(",\"lists\":[");
      boolean[][] variants = {{false, false}, {true, true}};
      for (int v = 0; v < variants.length; v++) {
         ProblemListView view = work.createListView(null, ex, variants[v][0], variants[v][1], restrict, v == 1 ? exclude : null);
         ProblemSearchPanel panel = new ProblemSearchPanel(view, work, ex);
         if (v > 0) out.append(',');
         out.append("{\"multiple\":").append(variants[v][0]).append(",\"showHidden\":").append(variants[v][1]).append(",\"excluding\":").append(v == 1)
            .append(",\"rows\":").append(rowsJson(view)).append(",\"selected\":").append(view.getSelectedIndex())
            .append(",\"searchTexts\":").append(arr(Arrays.asList(view.searchTexts))).append(",\"filters\":[");
         for (int k = 0; k < queries.length; k++) {
            panel.searchField.setText(queries[k]);
            panel.filterChanged();
            if (k > 0) out.append(',');
            out.append("{\"query\":").append(q(queries[k])).append(",\"rows\":").append(rowsJson(view)).append(",\"selected\":").append(view.getSelectedIndex())
               .append(",\"count\":").append(q(panel.countLabel.getText())).append("}");
         }
         out.append("]}");
      }
      out.append("]}\n");
   }

   static String rowsJson(ProblemListView view) {
      List<Object> rows = new ArrayList<>();
      for (int i = 0; i < view.getItemCount(); i++) {
         Object o = view.listModel.getElementAt(i);
         String text = o instanceof javax.swing.JLabel ? ((javax.swing.JLabel) o).getText() : String.valueOf(o);
         String hover = o instanceof AnswerListLabel ? ((AnswerListLabel) o).getToolTipText() : null;
         java.awt.Color c = ((java.awt.Component) o).getForeground();
         rows.add(new Raw("[" + view.rowToProblem[i] + "," + q(text) + "," + q(hover) + "," + (c == null ? "null" : c.getRGB()) + "]"));
      }
      return arr(rows);
   }
}

package edu.ucla.phil.logic;

import java.awt.Component;
import java.util.*;

/**
 * Oracle for the Symbolization module (src/engine/modules/symbolization). Loads the module
 * as the desktop does (messages, answers, options, exercises, work), then for every problem
 * with answers builds each answer, and mutations of it, as student work and records what the
 * real classes compute: the check status, the error buttons and their messages, the closest
 * answer, hints, the error dialog's actions, evaluateWork, direct entry and connective
 * changes. Prints JSON on standard output. Long texts are given as String.hashCode values.
 *
 *   OracleSymbolization [maxProblems]
 */
public class OracleSymbolization {
   static StringBuilder out = new StringBuilder();
   static String q(Object o) { return Oracle.q(o); }
   static String h(String s) { return s == null ? "null" : Integer.toString(s.hashCode()); }

   // ---- a record's tree of node codes, for mutations ----
   static final class T {
      String code; String text; List<T> kids = new ArrayList<>();
      T(String code, String text) { this.code = code; this.text = text; }
      T copy() { T t = new T(code, text); for (T k : kids) t.kids.add(k.copy()); return t; }
      int arity() {
         String c = code.trim();
         if (c.length() == 0) return 0;
         char f = c.charAt(0);
         if (f == '*') return 0;
         if (f == '@' || f == '!' || f == '%') return 1;
         int j = LogicProgram.indexOf(SymbolizationConstants.connSymbol, c);
         return j == -1 ? 0 : SymbolizationConstants.connArgTypes[j].length;
      }
      void preorder(List<T> l) { l.add(this); for (T k : kids) k.preorder(l); }
      void fields(StringBuilder b) {
         b.append(TaggedRecord.formatField(DelimitedTokenizer.escape(code, "\\:") + ":" + text, '+'));
         for (T k : kids) k.fields(b);
      }
      boolean isTerm() {
         String c = code.trim();
         if (c.startsWith("%")) return true;
         if (c.startsWith("*")) return c.endsWith("}1") || (c.indexOf('{') == -1 && Character.isLowerCase(c.charAt(1)));
         return false;
      }
   }

   static T parseTree(String record) {
      TaggedRecord t = new TaggedRecord(record);
      int[] idx = t.indexesOfTag('+');
      List<T> flat = new ArrayList<>();
      for (int i : idx) {
         DelimitedTokenizer d = new DelimitedTokenizer("\\:");
         d.setInput(t.valueAt(i));
         String code = d.nextToken();
         String text = d.getRemaining();
         flat.add(new T(code, text == null ? "" : text));
      }
      int[] pos = {0};
      return flat.isEmpty() ? null : build(flat, pos);
   }

   static T build(List<T> flat, int[] pos) {
      if (pos[0] >= flat.size()) return null;
      T t = flat.get(pos[0]++);
      int n = t.arity();
      for (int i = 0; i < n; i++) { T k = build(flat, pos); if (k == null) break; t.kids.add(k); }
      return t;
   }

   static String fields(T t) { StringBuilder b = new StringBuilder(); t.fields(b); return b.toString(); }

   static String nextOf(String letters, char c) {
      int i = letters.indexOf(c);
      return i == -1 ? null : String.valueOf(letters.charAt((i + 1) % letters.length()));
   }

   /** Mutations of an answer tree: name -> new tree (null if not applicable). */
   static LinkedHashMap<String, T> mutations(T root, int seed) {
      LinkedHashMap<String, T> m = new LinkedHashMap<>();
      String[] binaries = {"->", "&", "|", "<->"};
      m.put("conn", mutate(root, seed, t -> Arrays.asList(binaries).contains(t.code.trim()), t -> {
         t.code = binaries[(Arrays.asList(binaries).indexOf(t.code.trim()) + 1) % 4];
      }));
      m.put("swap", mutate(root, seed, t -> Arrays.asList(binaries).contains(t.code.trim()), t -> Collections.reverse(t.kids)));
      m.put("atom", mutate(root, seed, t -> t.code.trim().startsWith("*") && t.code.trim().length() > 1
            && Character.isUpperCase(t.code.trim().charAt(1)), t -> {
         String c = t.code.trim();
         String n = nextOf(c.charAt(1) >= 'P' ? "PQRSTUVWXYZ" : "FGHIJKLMNO", c.charAt(1));
         if (n == null) n = "Q";
         t.code = "*" + n + c.substring(2);
      }));
      m.put("atomvar", mutate(root, seed, t -> t.code.trim().startsWith("*") && hasVar(t.code), t -> {
         t.code = swapVars(t.code, false);
      }));
      m.put("var", mutate(root, seed, t -> "@!%".indexOf(t.code.trim().charAt(0)) != -1 && t.code.trim().length() > 1, t -> {
         String c = t.code.trim();
         t.code = c.charAt(0) + (c.substring(1).trim().equals("x") ? "y" : "x");
      }));
      m.put("rename", renameAll(root));
      m.put("capture", capture(root, seed));
      m.put("quant", mutate(root, seed, t -> t.code.trim().startsWith("@") || t.code.trim().startsWith("!"), t -> {
         String c = t.code.trim();
         t.code = (c.charAt(0) == '@' ? "!" : "@") + c.substring(1);
      }));
      m.put("none", mutate(root, seed + 1, t -> t != root, t -> { t.code = "?"; t.kids.clear(); }));
      m.put("rootnone", mutate(root, 0, t -> t == root, t -> { t.code = "?"; t.kids.clear(); }));
      m.put("neg", wrap(root, seed, 1));
      m.put("dneg", wrap(root, seed, 2));
      m.put("dropneg", dropNeg(root, seed));
      m.put("unrest", mutate(root, seed, t -> t.kids.size() == 1 && (t.code.trim().startsWith("@") && t.kids.get(0).code.trim().equals("->")
            || t.code.trim().startsWith("!") && t.kids.get(0).code.trim().equals("&")), t -> {
         T k = t.kids.get(0);
         k.code = k.code.trim().equals("->") ? "&" : "->";
      }));
      return m;
   }

   interface Pred { boolean test(T t); }
   interface Act { void run(T t); }

   static T mutate(T root, int seed, Pred p, Act a) {
      T r = root.copy();
      List<T> nodes = new ArrayList<>();
      r.preorder(nodes);
      List<T> ok = new ArrayList<>();
      for (T t : nodes) if (p.test(t)) ok.add(t);
      if (ok.isEmpty()) return null;
      a.run(ok.get(Math.floorMod(seed, ok.size())));
      return r;
   }

   static boolean hasVar(String code) {
      for (char c : code.toCharArray()) if (c == 'x' || c == 'y') return true;
      return false;
   }

   static String swapVars(String s, boolean all) {
      StringBuilder b = new StringBuilder();
      boolean done = false;
      for (char c : s.toCharArray()) {
         if (!done && (c == 'x' || c == 'y')) { b.append(c == 'x' ? 'y' : 'x'); if (!all) done = true; }
         else b.append(c);
      }
      return b.toString();
   }

   /** Renames x <-> y and z -> w everywhere (codes and English placeholders stay). */
   static T renameAll(T root) {
      T r = root.copy();
      List<T> nodes = new ArrayList<>();
      r.preorder(nodes);
      boolean any = false;
      for (T t : nodes) {
         String c = t.code;
         if (c.trim().startsWith("*") || "@!%".indexOf(c.trim().charAt(0)) != -1) {
            String n = swapVars(c, true);
            if (!n.equals(c)) any = true;
            t.code = n;
         }
      }
      return any ? r : null;
   }

   /** An inner binder takes an enclosing binder's variable, with its bound uses renamed (a capture). */
   static T capture(T root, int seed) {
      T r = root.copy();
      List<T[]> pairs = new ArrayList<>();
      collectCaptures(r, new ArrayList<>(), pairs);
      if (pairs.isEmpty()) return null;
      T[] p = pairs.get(Math.floorMod(seed, pairs.size()));
      String outer = p[0].code.trim().substring(1).trim();
      String inner = p[1].code.trim().substring(1).trim();
      p[1].code = p[1].code.trim().charAt(0) + outer;
      List<T> nodes = new ArrayList<>();
      p[1].preorder(nodes);
      for (T t : nodes) {
         if (t.code.trim().startsWith("*")) t.code = t.code.replace(inner, outer);
      }
      return r;
   }

   static void collectCaptures(T t, List<T> binders, List<T[]> pairs) {
      boolean binder = t.code.trim().length() > 1 && "@!%".indexOf(t.code.trim().charAt(0)) != -1;
      if (binder) {
         for (T b : binders) {
            if (!b.code.trim().substring(1).trim().equals(t.code.trim().substring(1).trim())) pairs.add(new T[]{b, t});
         }
         binders.add(t);
      }
      for (T k : t.kids) collectCaptures(k, binders, pairs);
      if (binder) binders.remove(binders.size() - 1);
   }

   static T wrap(T root, int seed, int times) {
      T r = root.copy();
      List<T> nodes = new ArrayList<>();
      r.preorder(nodes);
      List<T> ok = new ArrayList<>();
      for (T t : nodes) if (!t.isTerm()) ok.add(t);
      if (ok.isEmpty()) return null;
      T target = ok.get(Math.floorMod(seed, ok.size()));
      T inner = new T(target.code, target.text);
      inner.kids = target.kids;
      T cur = inner;
      for (int i = 0; i < times; i++) { T n = new T("~", target.text); n.kids.add(cur); cur = n; }
      target.code = cur.code; target.text = cur.text; target.kids = cur.kids;
      return r;
   }

   static T dropNeg(T root, int seed) {
      T r = root.copy();
      List<T> nodes = new ArrayList<>();
      r.preorder(nodes);
      List<T> ok = new ArrayList<>();
      for (T t : nodes) if (t.code.trim().equals("~") && t.kids.size() == 1) ok.add(t);
      if (ok.isEmpty()) return null;
      T t = ok.get(Math.floorMod(seed, ok.size()));
      T k = t.kids.get(0);
      t.code = k.code; t.text = k.text; t.kids = k.kids;
      return r;
   }

   // ---- inspection of the real tree ----

   static void preorder(SymbolizationNode n, String path, List<Object[]> l) {
      l.add(new Object[]{n, path});
      int k = SymbolizationConstants.connArgTypes[n.connective].length;
      for (int j = 0; j < k; j++) {
         SymbolizationNode c = n.getChildNode(j);
         if (c != null) preorder(c, path + j, l);
      }
   }

   static String pathOf(SymbolizationNode n) {
      String p = "";
      while (n.getParentNode() != null) { p = n.getParentNode().indexOfChildNode(n) + p; n = n.getParentNode(); }
      return p;
   }

   static String errorsJson(SymbolizationNode root, boolean full) {
      List<Object[]> l = new ArrayList<>();
      preorder(root, "", l);
      StringBuilder b = new StringBuilder("[");
      boolean first = true;
      for (Object[] e : l) {
         SymbolizationNode n = (SymbolizationNode) e[0];
         SymbolizationConnectivePanel p = n.getConnectivePanel();
         if (p == null) continue;
         for (Component c : p.getComponents()) {
            if (!(c instanceof SymbolizationErrorButton)) continue;
            SymbolizationErrorButton eb = (SymbolizationErrorButton) c;
            eb.buildMessage();
            if (!first) b.append(',');
            first = false;
            b.append("{\"path\":").append(q(e[1])).append(",\"known\":").append(p.errorButton == eb)
             .append(",\"answer\":").append(q(pathOf(eb.answer)))
             .append(",\"tb\":").append(q(String.join(",", (Vector<String>) eb.targetBinders)))
             .append(",\"ab\":").append(q(String.join(",", (Vector<String>) eb.answerBinders)))
             .append(",\"id\":").append(q(eb.messageId)).append(",\"hash\":").append(h(eb.messageText));
            if (full) b.append(",\"text\":").append(q(eb.messageText));
            b.append('}');
         }
      }
      return b.append(']').toString();
   }

   static LPSymbolizer lp;

   /** Loads the problem and puts the work (+ fields) into its tree (the Answer Manager's Use). */
   static void loadCase(String problemRecord, int index, String work) {
      lp.loadProblem(problemRecord);
      lp.problemIndex = index;
      if (work != null) lp.problem.loadRecord(new TaggedRecord(work), false, false);
   }

   static class Scripted extends NodeMessageHandler {
      String action;
      Scripted(String buttons) { super(buttons); }
      @Override String getSelectedAction(MessageDialog d) { return action; }
   }

   static String actionsJson(SymbolizationErrorButton eb) {
      StringBuilder b = new StringBuilder("{");
      // Up, repeatedly
      eb.buildMessage();
      Scripted s = new Scripted("Up:up");
      s.setProperty("target", eb.target);
      s.setProperty("answer", eb.answer);
      s.setProperty("targetBinders", eb.targetBinders.clone());
      s.setProperty("answerBinders", eb.answerBinders.clone());
      s.action = "up";
      b.append("\"up\":[");
      for (int i = 0; i < 10; i++) {
         if (i > 0) b.append(',');
         SymbolizationNode before = (SymbolizationNode) s.getProperty("target");
         try { s.handleChoice(null); } catch (NullPointerException e) { /* the dialog's content */ }
         SymbolizationNode after = (SymbolizationNode) s.getProperty("target");
         if (after == before) { b.append("\"beep\""); break; }
         Message m = SymbolizationMessages.get("symnot001");
         String text = Message.substitute(m.text, SymbolizationHint.hintParams((SymbolizationNode) s.getProperty("answer"),
            (Vector) s.getProperty("targetBinders"), (Vector) s.getProperty("answerBinders")));
         b.append("{\"path\":").append(q(pathOf(after))).append(",\"hash\":").append(h(text)).append("}");
      }
      b.append("]");
      // Text
      Scripted t = new Scripted("Text:text");
      t.setProperty("target", eb.target);
      t.setProperty("answer", eb.answer);
      t.setProperty("targetBinders", eb.targetBinders.clone());
      t.setProperty("answerBinders", eb.answerBinders.clone());
      t.action = "text";
      t.handleChoice(null);
      b.append(",\"text\":").append(q(eb.target.textPanel.textPane.getText()));
      // Symb
      Scripted y = new Scripted("Symb:symb");
      y.setProperty("target", eb.target);
      y.setProperty("answer", eb.answer);
      y.setProperty("targetBinders", eb.targetBinders.clone());
      y.setProperty("answerBinders", eb.answerBinders.clone());
      y.action = "symb";
      String ex = null;
      try { y.handleChoice(null); } catch (Exception e) { ex = e.getClass().getSimpleName(); }
      b.append(",\"symbException\":").append(q(ex));
      b.append(",\"symb\":").append(q(lp.problem.toRecord(true)));
      return b.append('}').toString();
   }

   static String hintsJson(String problemRecord, int index, String work) {
      loadCase(problemRecord, index, work);
      List<Object[]> l = new ArrayList<>();
      preorder(lp.problem, "", l);
      List<String> paths = new ArrayList<>();
      for (Object[] e : l) paths.add((String) e[1]);
      StringBuilder b = new StringBuilder("[");
      for (int i = 0; i < paths.size(); i++) {
         loadCase(problemRecord, index, work);
         SymbolizationNode node = nodeAt(lp.problem, paths.get(i));
         if (i > 0) b.append(',');
         SymbolizationNode root = lp.problem;
         SymbolizationNode closest = root.findClosestAnswer();
         if (closest == null) { b.append("{\"kind\":\"none\"}"); continue; }
         root.clearErrors();
         HintCollector hc = new HintCollector(node);
         root.matchTree(closest, new Vector(), new Vector(), hc);
         SymbolizationHint hint = hc.getHint();
         if (hint != null) {
            hint.buildMessage();
            b.append("{\"kind\":\"hint\",\"hash\":").append(h(hint.messageText)).append('}');
         } else {
            int before = lp.errorCount;
            loadCase(problemRecord, index, work);
            nodeAt(lp.problem, paths.get(i)).showHint();
            b.append("{\"kind\":\"error\",\"count\":").append(lp.errorCount - before).append(",\"errors\":")
             .append(errorsJson(lp.problem, false)).append('}');
         }
      }
      return b.append(']').toString();
   }

   static SymbolizationNode nodeAt(SymbolizationNode n, String path) {
      for (char c : path.toCharArray()) n = n.getChildNode(c - '0');
      return n;
   }

   static String directJson(String problemRecord, int index, String formula) {
      loadCase(problemRecord, index, null);
      String ex = null;
      try {
         lp.lastDirect = LogicProgram.translateSymbols(formula, LogicProgram.symbols, ModuleConstants.maggie);
         lp.problem.buildFromText(lp.lastDirect);
         if (!lp.checkDisabled && !lp.errorMessagesDisabled) {
            SymbolizationNode c = lp.problem.findClosestAnswer();
            if (c != null) {
               Expression e = c.toExpression();
               Expression e1 = lp.problem.toExpression();
               if (e1 == null || e == null || e1.isAlphaEquivalent(e, new BinderMap())) lp.problem.copyTextFrom(lp.problem.findClosestAnswer());
            }
         }
      } catch (Exception e) { ex = e.getClass().getSimpleName(); }
      return "{\"formula\":" + q(formula) + ",\"exception\":" + q(ex) + ",\"record\":" + q(lp.problem.toRecord(true)) + "}";
   }

   static String editsJson(String problemRecord, int index, String work) {
      loadCase(problemRecord, index, work);
      List<Object[]> l = new ArrayList<>();
      preorder(lp.problem, "", l);
      StringBuilder b = new StringBuilder("[");
      boolean first = true;
      for (Object[] e : l) {
         for (int kind = 0; kind <= 11; kind++) {
            loadCase(problemRecord, index, work);
            SymbolizationNode n = nodeAt(lp.problem, (String) e[1]);
            String label = kind == 11 ? "Fx" : null;
            String ex = null;
            SymbolizationNode r = null;
            try { r = n.setConnective(kind, label, false); } catch (Exception x) { ex = x.getClass().getSimpleName(); }
            if (!first) b.append(',');
            first = false;
            b.append("{\"path\":").append(q(e[1])).append(",\"kind\":").append(kind).append(",\"exception\":").append(q(ex))
             .append(",\"next\":").append(r == null ? "null" : q(pathOf(r))).append(",\"record\":").append(q(lp.problem.toRecord(true))).append('}');
         }
      }
      return b.append(']').toString();
   }

   static void restate(SymbolizationProblemSet set) {
      SymbolizationNode checker = new SymbolizationNode(null);
      TaggedRecord rec = new TaggedRecord();
      boolean changed;
      do {
         changed = false;
         for (int i = 0; i < set.size(); i++) {
            ProblemEntry e = set.getEntryAt(i);
            if (e != null && (e.state == 3 || e.state == 4)) {
               int before = e.state;
               rec.clear();
               rec.parse(e.name);
               checker.evaluateWork(rec, set, (SymbolizationEntry) e);
               if (e.state != before) changed = true;
            }
         }
      } while (changed);
   }

   static String statesJson(SymbolizationProblemSet set) {
      StringBuilder b = new StringBuilder("[");
      for (int i = 0; i < set.size(); i++) {
         SymbolizationEntry e = (SymbolizationEntry) set.getEntryAt(i);
         if (i > 0) b.append(',');
         b.append("[").append(q(TaggedRecord.nameOf(e.name))).append(',').append(e.state).append(',').append(e.answerIndex).append(']');
      }
      return b.append(']').toString();
   }

   public static void main(String[] args) throws Exception {
      java.io.PrintStream stdout = System.out;
      System.setOut(System.err);
      Oracle.init();
      int max = args.length > 0 ? Integer.parseInt(args[0]) : Integer.MAX_VALUE;
      if (!LPSymbolizer.getExercises()) throw new IllegalStateException("exercises");
      restate(LPSymbolizer.exercises);
      if (!LPSymbolizer.getProblems()) throw new IllegalStateException("problems");
      LPSymbolizer.problems.mergeExercises();
      restate(LPSymbolizer.problems);
      out.append("{\"exerciseStates\":").append(statesJson(LPSymbolizer.exercises));
      out.append(",\"problemStates\":").append(statesJson(LPSymbolizer.problems));
      lp = new LPSymbolizer(false);
      LPSymbolizer.newProblem = lp.saveProblem();

      // schemes
      out.append(",\"schemes\":[");
      boolean first = true;
      for (int i = 0; i < LPSymbolizer.exercises.size(); i++) {
         TaggedRecord t = new TaggedRecord(LPSymbolizer.exercises.getRecordAt(i));
         String s = t.valueAt(t.indexOfTag('='));
         if (s == null) continue;
         SchemeEditor ed = new SchemeEditor(true);
         ed.setScheme(s);
         StringBuilder rows = new StringBuilder("[");
         for (int r = 0; r < ed.getRowCount(); r++) {
            if (r > 0) rows.append(',');
            rows.append('[').append(q(((EditableTextPane) ed.symbolFields.get(r)).getText())).append(',')
                .append(q(((EditableTextPane) ed.englishFields.get(r)).getText())).append(']');
         }
         rows.append(']');
         if (!first) out.append(',');
         first = false;
         out.append("{\"scheme\":").append(q(s)).append(",\"rows\":").append(rows).append(",\"encoded\":").append(q(ed.getScheme())).append('}');
      }
      out.append(']');

      out.append(",\"cases\":[");
      first = true;
      int problemsDone = 0, caseNo = 0;
      SymbolizationProblemSet problems = LPSymbolizer.problems;
      for (int i = 0; i < problems.size() && problemsDone < max; i++) {
         String record = problems.getRecordAt(i);
         lp.loadProblem(record);
         Vector answers = lp.problem.answers;
         if (answers == null || answers.isEmpty()) continue;
         problemsDone++;
         String name = TaggedRecord.nameOf(record);
         for (int a = 0; a < answers.size(); a++) {
            String answer = (String) answers.get(a);
            T tree = parseTree(answer);
            LinkedHashMap<String, T> works = new LinkedHashMap<>();
            works.put("answer", tree);
            if (tree != null) works.putAll(mutations(tree, a + i));
            for (Map.Entry<String, T> w : works.entrySet()) {
               if (w.getValue() == null) continue;
               String work = fields(w.getValue());
               caseNo++;
               loadCase(record, i, work);
               int e0 = lp.errorCount;
               lp.checkProblem();
               SymbolizationNode closest = lp.problem.findClosestAnswer();
               if (!first) out.append(',');
               first = false;
               out.append("{\"problem\":").append(q(name)).append(",\"index\":").append(i).append(",\"answer\":").append(a)
                  .append(",\"mutation\":").append(q(w.getKey())).append(",\"work\":").append(q(work))
                  .append(",\"formula\":").append(q(lp.problem.toString()))
                  .append(",\"record\":").append(q(lp.problem.toRecord(true)))
                  .append(",\"status\":").append(q(lp.titlePanel.getStatus()))
                  .append(",\"errorCount\":").append(lp.errorCount - e0)
                  .append(",\"countAnswers\":").append(lp.problem.countAnswers())
                  .append(",\"closest\":").append(closest == null ? "null" : q(closest.toRecord(true)))
                  .append(",\"matching\":").append(closest == null ? "null" : Integer.toString(lp.problem.countMatchingNodes(closest)))
                  .append(",\"errors\":").append(errorsJson(lp.problem, caseNo % 25 == 0));
               // the first error's dialog actions
               if (caseNo % 2 == 0) {
                  List<Object[]> l = new ArrayList<>();
                  preorder(lp.problem, "", l);
                  SymbolizationErrorButton eb = null;
                  for (Object[] e : l) {
                     SymbolizationConnectivePanel p = ((SymbolizationNode) e[0]).getConnectivePanel();
                     if (p != null && p.errorButton != null) { eb = p.errorButton; break; }
                  }
                  if (eb != null) out.append(",\"actions\":").append(actionsJson(eb));
               }
               // evaluateWork
               loadCase(record, i, work);
               String full = lp.problem.toRecord(true);
               SymbolizationEntry entry = LPSymbolizer.getProblemState(full, problems, null);
               out.append(",\"evaluated\":").append(q(full)).append(",\"state\":").append(entry.state).append(",\"answerIndex\":").append(entry.answerIndex);
               if (caseNo % 3 == 0) out.append(",\"hints\":").append(hintsJson(record, i, work));
               // direct entry of the formula (and a malformed one)
               loadCase(record, i, work);
               if (!lp.problem.isIncomplete()) {
                  String f = lp.problem.toString();
                  out.append(",\"direct\":[").append(directJson(record, i, f));
                  if (caseNo % 10 == 0) out.append(',').append(directJson(record, i, f + ")"));
                  out.append(']');
               }
               if (w.getKey().equals("answer") && problemsDone <= 25) out.append(",\"edits\":").append(editsJson(record, i, work));
               out.append('}');
            }
         }
      }
      out.append("]}");
      stdout.print(out);
      stdout.flush();
      System.exit(0);
   }
}

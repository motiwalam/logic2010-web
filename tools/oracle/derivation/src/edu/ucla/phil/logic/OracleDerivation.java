package edu.ucla.phil.logic;

import java.io.File;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Vector;

/**
 * Oracle for the derivation module (src/engine/modules/derivation). Modes:
 *   check [student]   replays every problem with work through Check (serial mode) in a module
 *                     with a window, and records the lines' messages, the state, the re-encoded
 *                     work; plus the states the hidden restate computes.
 *   lines [student]   re-checks lines interactively with variants of their justifications.
 *   stack [student]   the stack and the applicable rules at cursor positions.
 *   edit              scripted editing operations.
 * With "student" the work is the student work file (-Doracle.student); otherwise a fresh
 * student's work (the course problems).
 */
public class OracleDerivation {
   static StringBuilder out = new StringBuilder();

   public static void main(String[] args) throws Exception {
      java.io.PrintStream stdout = System.out;
      System.setOut(new java.io.PrintStream(java.io.OutputStream.nullOutputStream()));
      Oracle.init();
      boolean student = args.length > 1 && args[1].equals("student");
      if (student) System.setProperty("oracle.mode.student", "1");
      setup(student);
      switch (args[0]) {
         case "check": check(); break;
         case "lines": lines(); break;
         case "stack": stack(); break;
         case "edit": edit(); break;
         default: throw new IllegalArgumentException(args[0]);
      }
      stdout.print(out);
      stdout.flush();
      System.exit(0);
   }

   static void setup(boolean student) throws Exception {
      if (student) {
         Path s = Path.of(System.getProperty("oracle.student"));
         Files.writeString(new File(LogicProgram.workDir, "derivation.rec").toPath(), Files.readString(s, StandardCharsets.UTF_8), StandardCharsets.UTF_8);
      }
      Oracle.quiet(() -> LPDerivation.getExercises());
      DerivationProblemSet problems = LPDerivation.readWork();
      LPDerivation.problems = problems;
      problems.rebuildUserRules();
      DerivationProblemEntry.workProblemNames = ProblemEntry.findExtraProblems("derwork.txt", problems);
      ProblemEntry.markExtraProblems(LPDerivation.exercises, DerivationProblemEntry.workProblemNames);
      problems.mergeExercises();
      restate(problems);
   }

   /** ProblemRestateTask, run to completion. */
   static void restate(ProblemSet set) {
      LPDerivation.restating = true;
      LPDerivation module = new LPDerivation(false);
      TaggedRecord record = new TaggedRecord();
      boolean changed = false;
      int count = set.size();
      for (int index = 0; ; index++) {
         if (index == count) {
            if (!changed) break;
            index = 0;
            changed = false;
         }
         ProblemEntry e = set.getEntryAt(index);
         if (e != null && (e.state == 3 || e.state == 4)) {
            int before = e.state;
            record.clear();
            record.parse(e.name);
            e.state = module.getProblemState(record);
            if (e.state != before) changed = true;
         }
      }
      LPDerivation.restating = false;
   }

   /** A module with a (fake) window: dialogs can open and messages are substituted. */
   static LPDerivation windowModule() throws Exception {
      LPDerivation m = new LPDerivation(false);
      Field f = sun.misc.Unsafe.class.getDeclaredField("theUnsafe");
      f.setAccessible(true);
      sun.misc.Unsafe unsafe = (sun.misc.Unsafe)f.get(null);
      m.frame = (ModuleFrame)unsafe.allocateInstance(ModuleFrame.class);
      m.doSubs = true;
      return m;
   }

   // ---- JSON of the derivation ----

   static void lines(DerivationBox box, List<DerivationLine> out) {
      int n = box.getContentCount();
      for (int i = 0; i < n; i++) {
         DerivationNode node = box.getNode(i);
         if (node instanceof DerivationBox) lines((DerivationBox)node, out);
         else out.add((DerivationLine)node);
      }
   }

   static String md5(String s) {
      return Scrambler.md5Base64(s);
   }

   static String lineJson(DerivationLine l) {
      return lineJson(l, true);
   }

   static String lineJson(DerivationLine l, boolean withExplanation) {
      StringBuilder b = new StringBuilder("{");
      String kind = l.box.showLine == l ? (l.box.parentBox == null ? "P" : "S") : (l.box.cancelLine == l ? "C" : "L");
      b.append("\"n\":").append(l.getLineNumber()).append(",\"k\":").append(Oracle.q(kind));
      b.append(",\"f\":").append(Oracle.q(l.getFormulaText(false))).append(",\"a\":").append(Oracle.q(l.getAnnotationText(false)));
      b.append(",\"id\":").append(Oracle.q(l.message == null ? null : l.message.id.toLowerCase()));
      b.append(",\"text\":").append(Oracle.q(l.messagePane.getText()));
      b.append(",\"phase\":").append(l.messagePhase);
      if (l.box.showLine == l && l.box.parentBox != null) b.append(",\"open\":").append(l.box.isExpanded());
      if (withExplanation && l.messageButton.isVisible()) b.append(",\"x\":").append(Oracle.q(l.messageButton.explanation));
      b.append('}');
      return b.toString();
   }

   static String treeJson(LPDerivation m) {
      List<DerivationLine> ls = new ArrayList<>();
      lines(m.problem, ls);
      StringBuilder b = new StringBuilder("[");
      for (int i = 0; i < ls.size(); i++) b.append(i > 0 ? "," : "").append(lineJson(ls.get(i)));
      return b.append(']').toString();
   }

   static String encode(LPDerivation m) {
      m.loadTime = 0L;
      return m.saveProblem();
   }

   // ---- check ----

   static void check() throws Exception {
      DerivationProblemSet problems = LPDerivation.problems;
      out.append("{\"states\":[");
      for (int i = 0; i < problems.size(); i++) {
         ProblemEntry e = problems.getEntryAt(i);
         out.append(i > 0 ? "," : "").append("[").append(Oracle.q(TaggedRecord.nameOf(e.name))).append(',').append(e.state).append(']');
      }
      out.append("],\"checks\":[");
      boolean first = true;
      for (int i = 0; i < problems.size(); i++) {
         String record = problems.getRecordAt(i);
         if (!LPDerivation.hasWork(new TaggedRecord(record))) continue;
         LPDerivation m = windowModule();
         m.loadProblem(record);
         m.problemIndex = i;
         String loaded = encode(m);
         OracleDialogs.reset(new ArrayList<>());
         String error = null;
         boolean ok = false;
         try {
            ok = m.checkProblem();
         } catch (RuntimeException ex) {
            error = ex.toString();
         }
         out.append(first ? "" : ",").append("\n{\"name\":").append(Oracle.q(TaggedRecord.nameOf(record)));
         first = false;
         out.append(",\"record\":").append(Oracle.q(record)).append(",\"loaded\":").append(Oracle.q(loaded));
         out.append(",\"ok\":").append(ok).append(",\"state\":").append(ok ? 2 : (m.proofMissing ? 3 : 1));
         out.append(",\"status\":").append(Oracle.q(m.titlePanel.getStatus()));
         out.append(",\"errors\":").append(m.errorCount).append(",\"error\":").append(Oracle.q(error));
         out.append(",\"lines\":").append(treeJson(m));
         out.append(",\"dialogs\":[").append(OracleDialogs.log()).append(']');
         out.append(",\"messages\":").append(Oracle.q(m.saveMessages()));
         out.append(",\"saved\":").append(Oracle.q(encode(m))).append('}');
      }
      out.append("]}\n");
   }

   /** The problems a mode goes through: every one with work (every fourth of a student's). */
   static List<Integer> sample(boolean studentWork, int every) {
      List<Integer> out = new ArrayList<>();
      DerivationProblemSet problems = LPDerivation.problems;
      int k = 0;
      for (int i = 0; i < problems.size(); i++) {
         if (!LPDerivation.hasWork(new TaggedRecord(problems.getRecordAt(i)))) continue;
         if (k++ % every == 0) out.add(i);
      }
      return out;
   }

   static DerivationLine lineAt(LPDerivation m, int n) {
      DerivationNode node = n == 0 ? m.problem : m.problem.findLine(n);
      return node instanceof DerivationBox ? ((DerivationBox)node).showLine : (DerivationLine)node;
   }

   /** The variants of a line's justification: [text, mode, script] (mode i: interactive, c: clear the formula, n: not interactive, p: formula P, not interactive). */
   static List<String[]> variants(DerivationLine l) {
      List<String[]> v = new ArrayList<>();
      String a = l.getAnnotationText(false);
      String f = l.formulaEditor == null ? null : l.formulaEditor.getText();
      boolean normal = l.formulaEditor != null;
      int lastStart = a.length();
      while (lastStart > 0 && !Character.isWhitespace(a.charAt(lastStart - 1))) lastStart--;
      String head = a.substring(0, lastStart);
      String last = a.substring(lastStart);
      v.add(new String[]{a, "i", ""});
      v.add(new String[]{a, "n", ""});
      v.add(new String[]{a, "i", "choice:1|text:a"});
      if (normal) {
         v.add(new String[]{a, "c", ""});
         v.add(new String[]{a, "p", ""});
         if (f != null && !f.trim().isEmpty() && !last.isEmpty()) {
            v.add(new String[]{a + "[" + f + "]", "i", ""});
            v.add(new String[]{a + "[" + f + "]", "c", ""});
            v.add(new String[]{a + "[P&~P]", "i", ""});
         }
      }
      if (!last.isEmpty()) {
         v.add(new String[]{head + "ZZ", "i", ""});
         v.add(new String[]{a + "/a", "i", ""});
         v.add(new String[]{a + "/a", "n", ""});
         v.add(new String[]{head + "DUP DROP " + last, "i", ""});
         v.add(new String[]{head + "SWAP SWAP " + last, "i", ""});
         v.add(new String[]{head + "DUP " + last, "i", ""});
         v.add(new String[]{head + "SWAP " + last, "n", ""});
      }
      // citations shifted, and the first made relative
      StringBuilder shifted = new StringBuilder();
      StringBuilder relative = new StringBuilder();
      boolean firstNumber = true;
      for (int i = 0; i < a.length(); ) {
         char c = a.charAt(i);
         if (Character.isDigit(c)) {
            int j = i;
            while (j < a.length() && Character.isDigit(a.charAt(j))) j++;
            int n = Integer.parseInt(a.substring(i, j));
            shifted.append(n > 1 ? n - 1 : n + 1);
            relative.append(firstNumber && n < l.getLineNumber() ? "-" + (l.getLineNumber() - n) : a.substring(i, j));
            firstNumber = false;
            i = j;
         } else {
            shifted.append(c);
            relative.append(c);
            i++;
         }
      }
      if (!shifted.toString().equals(a)) v.add(new String[]{shifted.toString(), "i", ""});
      if (!relative.toString().equals(a)) v.add(new String[]{relative.toString(), "i", ""});
      return v;
   }

   static void lines() throws Exception {
      boolean studentWork = LPDerivation.problems.getRecord("Deriv 1.001EG1") != null && System.getProperty("oracle.mode.student") != null;
      out.append("{\"lines\":[");
      boolean first = true;
      for (int i : sample(studentWork, studentWork ? 5 : 2)) {
         String record = LPDerivation.problems.getRecordAt(i);
         LPDerivation probe = windowModule();
         probe.loadProblem(record);
         List<DerivationLine> ls = new ArrayList<>();
         lines(probe.problem, ls);
         for (DerivationLine l0 : ls) {
            if (l0.annotationEditor == null) continue;
            for (String[] v : variants(l0)) {
               LPDerivation m = windowModule();
               m.loadProblem(record);
               m.problemIndex = i;
               DerivationLine l = lineAt(m, l0.getLineNumber());
               l.setAnnotationText(v[0]);
               if (v[1].equals("c")) {
                  l.setFormulaText("");
                  l.parseFormula();
               } else if (v[1].equals("p")) {
                  l.setFormulaText("P");
                  l.parseFormula();
               }
               OracleDialogs.reset(v[2].isEmpty() ? new ArrayList<>() : Arrays.asList(v[2].split("\\|(?=[a-z]+:)")));
               boolean interactive = v[1].equals("i") || v[1].equals("c");
               String error = null;
               boolean ok = false;
               boolean ready = false;
               try {
                  m.abort(false);
                  m.resetVarNames();
                  l.justifications = null;
                  l.parseReferences();
                  ok = l.checkLine(interactive);
                  ready = l.readyToCancel;
                  if (interactive && ok && ready) l.toggleBoxAndCancel();
               } catch (RuntimeException ex) {
                  error = ex.getClass().getSimpleName();
               }
               out.append(first ? "" : ",").append("\n{\"name\":").append(Oracle.q(TaggedRecord.nameOf(record)));
               first = false;
               out.append(",\"n\":").append(l0.getLineNumber()).append(",\"text\":").append(Oracle.q(v[0])).append(",\"mode\":").append(Oracle.q(v[1]))
                  .append(",\"script\":").append(Oracle.q(v[2]));
               out.append(",\"ok\":").append(ok).append(",\"ready\":").append(ready).append(",\"error\":").append(Oracle.q(error));
               out.append(",\"aborted\":").append(m.aborted()).append(",\"errors\":").append(m.errorCount);
               out.append(",\"line\":").append(lineJson(l, false)).append(",\"work\":").append(Oracle.q(l.encodeWork())).append(",\"messages\":[");
               List<DerivationLine> after = new ArrayList<>();
               lines(m.problem, after);
               boolean f2 = true;
               for (DerivationLine x : after) {
                  if (x == l || x.message == null) continue;
                  out.append(f2 ? "" : ",").append("[").append(x.getLineNumber()).append(',').append(Oracle.q(x.message.id.toLowerCase())).append(',').append(Oracle.q(x.messagePane.getText())).append(']');
                  f2 = false;
               }
               out.append("],\"dialogs\":[").append(OracleDialogs.log()).append("],\"saved\":").append(Oracle.q(md5(encode(m)))).append('}');
            }
         }
      }
      out.append("]}\n");
   }

   /** Cursor positions in a justification: its start, the end of each word, and inside the last word. */
   static List<Integer> positions(String a) {
      List<Integer> out = new ArrayList<>();
      out.add(0);
      for (int i = 1; i <= a.length(); i++) {
         if (i == a.length() || (Character.isWhitespace(a.charAt(i)) && !Character.isWhitespace(a.charAt(i - 1)))) out.add(i);
      }
      if (a.length() > 1) out.add(a.length() - 1);
      return out;
   }

   static void stack() throws Exception {
      boolean studentWork = System.getProperty("oracle.mode.student") != null;
      out.append("{\"views\":[");
      boolean first = true;
      for (int i : sample(studentWork, studentWork ? 16 : 5)) {
         String record = LPDerivation.problems.getRecordAt(i);
         LPDerivation m = windowModule();
         m.loadProblem(record);
         m.problemIndex = i;
         List<DerivationLine> ls = new ArrayList<>();
         lines(m.problem, ls);
         for (DerivationLine l : ls) {
            if (l.annotationEditor == null) continue;
            String a = l.annotationEditor.getText();
            List<Integer> ps = positions(a);
            for (int k = 0; k < ps.size(); k++) {
               int p = ps.get(k);
               String before = DerivationStackView.textBeforeCursor(a, p);
               DerivationStackView.Snapshot snap = DerivationStackView.compute(l, before);
               out.append(first ? "" : ",").append("\n{\"name\":").append(Oracle.q(TaggedRecord.nameOf(record)));
               first = false;
               out.append(",\"n\":").append(l.getLineNumber()).append(",\"caret\":").append(p).append(",\"before\":").append(Oracle.q(before));
               out.append(",\"formulas\":[");
               for (int f = 0; f < snap.formulas.size(); f++) out.append(f > 0 ? "," : "").append(Oracle.q(snap.formulas.elementAt(f).toString()));
               out.append("],\"origins\":[");
               for (int f = 0; f < snap.origins.size(); f++) out.append(f > 0 ? "," : "").append(Oracle.q((String)snap.origins.elementAt(f)));
               out.append("],\"error\":").append(Oracle.q(snap.error)).append(",\"closed\":").append(Oracle.q(snap.closed));
               // the applicable rules at the start, after the first word and at the end
               if (k <= 1 || k == ps.size() - 1) {
                  DerivationRulesView.Result r = DerivationRulesView.compute(l, before);
                  out.append(",\"rules\":{\"error\":").append(Oracle.q(r.error)).append(",\"closed\":").append(Oracle.q(r.closed)).append(",\"rows\":[");
                  for (int x = 0; x < r.rules.size(); x++) {
                     DerivationRulesView.Applicable ap = (DerivationRulesView.Applicable)r.rules.elementAt(x);
                     out.append(x > 0 ? "," : "").append("[").append(Oracle.q(ap.rule)).append(',').append(Oracle.q(ap.result)).append(',')
                        .append(Oracle.q(ap.lock)).append(',').append(ap.group).append(',').append(ap.unknowns).append(',').append(ap.matchesLine)
                        .append(',').append(Oracle.q(ap.command)).append(',').append(Oracle.q(ap.details())).append(']');
                  }
                  out.append("]}");
               }
               out.append('}');
            }
         }
      }
      out.append("]}\n");
   }

   /** The focused editor as "n:f" or "n:a", or null. */
   static String focusName(LPDerivation m) {
      DerivationLineEditor e = m.focus;
      if (e == null) return null;
      return e.line.getLineNumber() + ":" + (e == e.line.annotationEditor ? "a" : e == e.line.formulaEditor ? "f" : "?");
   }

   /** Moves the focus as the focus events would (focusLost, then focusGained's work). */
   static void focus(LPDerivation m, DerivationLineEditor e) {
      if (m.focus == e) return;
      if (m.focus != null) m.focus.focusLost(null);
      if (e != null && m.focus != e) {
         if (e == e.line.annotationEditor) {
            e.line.refreshReferenceNumbers();
            e.line.clearReferences();
         }
         e.restoreSelection();
         m.focus = e;
         m.lastFocus = e;
      }
   }

   static String state(LPDerivation m) {
      StringBuilder b = new StringBuilder("{\"focus\":").append(Oracle.q(focusName(m))).append(",\"lines\":[");
      List<DerivationLine> ls = new ArrayList<>();
      lines(m.problem, ls);
      for (int i = 0; i < ls.size(); i++) {
         DerivationLine l = ls.get(i);
         String kind = l.box.showLine == l ? (l.box.parentBox == null ? "P" : "S") : (l.box.cancelLine == l ? "C" : "L");
         b.append(i > 0 ? "," : "").append("[").append(l.getLineNumber()).append(',').append(Oracle.q(kind)).append(',')
            .append(Oracle.q(l.formulaEditor == null ? null : l.formulaEditor.getText())).append(',')
            .append(Oracle.q(l.annotationEditor == null ? null : l.annotationEditor.getText())).append(',')
            .append(Oracle.q(l.message == null ? null : l.message.id.toLowerCase())).append(',').append(l.box.getBoxDepth()).append(',')
            .append(l.box.showLine == l ? String.valueOf(l.box.isExpanded()) : "null").append(']');
      }
      return b.append("]}").toString();
   }

   static void edit() throws Exception {
      List<String> text = Files.readAllLines(Path.of(System.getProperty("oracle.editScripts")), StandardCharsets.UTF_8);
      out.append("{\"scripts\":[");
      boolean firstScript = true;
      List<List<String[]>> scripts = new ArrayList<>();
      List<String[]> cur = null;
      for (String line : text) {
         if (line.startsWith("#")) continue;
         if (line.trim().isEmpty()) { cur = null; continue; }
         if (cur == null) scripts.add(cur = new ArrayList<>());
         cur.add(line.split("\t", -1));
      }
      for (List<String[]> script : scripts) {
         LPDerivation m = windowModule();
         out.append(firstScript ? "" : ",").append("\n{\"steps\":[");
         firstScript = false;
         boolean first = true;
         for (String[] op : script) {
            String result = null;
            try {
               switch (op[0]) {
                  case "load": {
                     int i = LPDerivation.problems.indexOfName(op[1]);
                     m.loadProblem(LPDerivation.problems.getRecordAt(i));
                     m.problemIndex = i;
                     break;
                  }
                  case "user": m.loadUserProblem(op[1]); break;
                  case "focus": {
                     DerivationLine l = lineAt(m, Integer.parseInt(op[1]));
                     focus(m, op[2].equals("a") ? l.annotationEditor : l.formulaEditor);
                     break;
                  }
                  case "blur": focus(m, null); break;
                  case "text": m.focus.setText(op[1]); m.focus.setCaretPosition(op[1].length()); break;
                  case "caret": m.focus.setCaretPosition(Integer.parseInt(op[1])); break;
                  case "key": {
                     java.awt.event.KeyEvent ev = new java.awt.event.KeyEvent(m.focus, java.awt.event.KeyEvent.KEY_TYPED, 0L, Integer.parseInt(op[2]), java.awt.event.KeyEvent.VK_UNDEFINED, (char)Integer.parseInt(op[1]));
                     result = String.valueOf(m.focus.handleKeyTyped(ev));
                     break;
                  }
                  case "press": {
                     java.awt.event.KeyEvent ev = new java.awt.event.KeyEvent(m.focus, java.awt.event.KeyEvent.KEY_PRESSED, 0L, Integer.parseInt(op[2]), Integer.parseInt(op[1]), java.awt.event.KeyEvent.CHAR_UNDEFINED);
                     result = String.valueOf(m.focus.handleKeyPressed(ev));
                     break;
                  }
                  case "check": result = String.valueOf(m.checkProblem()); break;
                  case "record": m.loadProblem(op[1]); break;
                  case "answers": OracleDialogs.reset(op[1].isEmpty() ? new ArrayList<>() : Arrays.asList(op[1].split("\\|(?=[a-z]+:)"))); break;
                  case "checkline": {
                     DerivationLine l = lineAt(m, Integer.parseInt(op[1]));
                     m.abort(false);
                     m.resetVarNames();
                     l.justifications = null;
                     l.parseReferences();
                     result = String.valueOf(l.checkLine(op[2].equals("i")));
                     break;
                  }
                  case "save": result = encode(m); break;
                  default: throw new IllegalArgumentException(op[0]);
               }
            } catch (RuntimeException ex) {
               result = "X:" + ex.getClass().getSimpleName();
            }
            out.append(first ? "" : ",").append("{\"op\":").append(OracleDialogs.arr(Arrays.asList(op))).append(",\"result\":").append(Oracle.q(result))
               .append(",\"state\":").append(state(m)).append(",\"dialogs\":[").append(OracleDialogs.log()).append("]}");
            OracleDialogs.entries = new ArrayList<>();
            first = false;
         }
         out.append("],\"saved\":").append(Oracle.q(encode(m))).append('}');
      }
      out.append("]}\n");
   }
}

package edu.ucla.phil.logic;

import java.awt.Point;
import java.util.*;
import javax.swing.JCheckBox;

/**
 * Oracle for the Invalidity module (src/engine/modules/invalidity): for every problem of the
 * notation (and a few extra arguments), random interpretations over universes of size 1 to 4:
 * the model checker's values, the verdict and title summary, the saved record, problem
 * states, describeValues, shrinking the universe, interpretation-editor edits, quantifier
 * expansion in the workspace, and parse/encode of interpretation texts. Prints JSON.
 */
public class OracleInvalidity {
   static StringBuilder out = new StringBuilder();
   static Random rnd = new Random(11);

   static String q(Object o) { return Oracle.q(o); }

   static final String[] EXTRA = {
      "@x(Fx->Gx) . Ga .: Fa", "!x(Fx&Gx) .: @x(Fx|~Gx)", "@x!y Rxy .: !y@x Rxy", "P . @x(Fx<->P) .: !x~Fx",
      "@x(Fx->x=a) .: Fb", "@x f(x)=x .: f(a)=b", "!x(Fx&@y(Fy->y=x)) .: F(%x Fx)", "Fa . a=b .: Gb",
      "@x@y(Rxy->Ryx) .: @x Rxx", "~!x Fx .: P", "@x(Fx|Gx) . ~Fa .: G(f(a))"};

   public static void main(String[] args) throws Exception {
      java.io.PrintStream stdout = System.out;
      System.setOut(System.err);
      Oracle.init();
      if (!LPInvalidation.getExercises()) throw new IllegalStateException("exercises");
      LPInvalidation m = new LPInvalidation(false);
      List<String[]> problems = new ArrayList<>();
      for (int i = 0; i < LPInvalidation.exercises.size(); i++) {
         TaggedRecord t = new TaggedRecord(LPInvalidation.exercises.getRecordAt(i));
         String st = LPInvalidation.getProblemStatement(t);
         if (st != null) problems.add(new String[]{t.getName(), st, t.valueAt(t.indexOfTag('='))});
      }
      for (int i = 0; i < EXTRA.length; i++) problems.add(new String[]{"Extra " + i, EXTRA[i], null});
      out.append("{\"options\":[");
      for (int i = 0; i < LPInvalidation.exercises.size(); i++) {
         TaggedRecord t = new TaggedRecord(LPInvalidation.exercises.getRecordAt(i));
         for (int pr = 0; pr < 2; pr++) {
            LPInvalidation x = pr == 0 ? m : new LPInvalidation(true);
            x.loadExerciseInfo(t);
            boolean[] b = {x.checkDisabled, x.expandOff, x.expandAll, x.dontChange};
            StringBuilder bits = new StringBuilder();
            for (boolean z : b) bits.append(z ? '1' : '0');
            out.append(i + pr == 0 ? "" : ",").append('[').append(q(t.getName())).append(',').append(pr == 1).append(',').append(q(bits)).append(',').append(q(x.titlePanel.getNote())).append(']');
         }
      }
      out.append("],\n\"problems\":[");
      boolean first = true;
      for (String[] p : problems) {
         if (!first) out.append(",\n");
         first = false;
         problem(m, p[0], p[1], p[2]);
      }
      out.append("],\n\"parse\":[");
      String[] pieces = {"F", "G", "a", "f", "(", ")", "0", "1", "2", "(1)", "(2)", "(0)", "{", "}", "{0}", "{1,0}", "{0,1}", ",", ";", " ", "3", "-1", "{}", "\\", "x"};
      for (int i = 0; i < 1500; i++) {
         StringBuilder b = new StringBuilder();
         int n = 1 + rnd.nextInt(9);
         for (int j = 0; j < n; j++) b.append(pieces[rnd.nextInt(pieces.length)]);
         String s = b.toString();
         String r;
         try {
            SymbolInterpretation si = SymbolInterpretation.parse(s);
            r = si == null ? null : (si instanceof PredicateInterpretation ? "P:" : "O:") + si.encode() + "|" + si.describeValues(3);
         } catch (RuntimeException x) {
            r = "X:" + x.getClass().getSimpleName();
         }
         if (i > 0) out.append(',');
         out.append('[').append(q(s)).append(',').append(q(r)).append(']');
      }
      out.append("]}\n");
      stdout.print(out);
      stdout.flush();
      System.exit(0);
   }

   static String val(Object o) {
      return o == null ? "null" : o.toString();
   }

   static String genInterpretation(SymbolInterpretation s, int size) {
      StringBuilder b = new StringBuilder(s.getSignature());
      int tuples = 1;
      for (int k = 0; k < s.arity; k++) tuples *= size;
      int range = size + (rnd.nextInt(5) == 0 ? 2 : 0);
      if (s instanceof PredicateInterpretation) {
         if (s.arity == 0) return rnd.nextBoolean() ? b + "{}" : b.toString();
         double p = rnd.nextDouble();
         for (int t = 0; t < tuples; t++) if (rnd.nextDouble() < p) b.append(tuple(t, s.arity, range == size ? size : size + 1, range != size));
         return b.toString();
      }
      if (s.arity == 0) return rnd.nextInt(6) == 0 ? b.toString() : b.append(rnd.nextInt(range)).toString();
      int mode = rnd.nextInt(3);
      if (mode == 0) return b.append(rnd.nextInt(range)).toString();
      Map<Integer, StringBuilder> groups = new LinkedHashMap<>();
      for (int t = 0; t < tuples; t++) {
         if (mode == 1 && rnd.nextBoolean()) continue;
         groups.computeIfAbsent(rnd.nextInt(range), k -> new StringBuilder()).append(tuple(t, s.arity, size, false));
      }
      boolean first = true;
      for (Map.Entry<Integer, StringBuilder> e : groups.entrySet()) {
         b.append(first ? "" : ";").append(e.getKey()).append(e.getValue());
         first = false;
      }
      if (mode == 1) b.append(first ? "" : ";").append(rnd.nextInt(range));
      return b.toString();
   }

   static String tuple(int t, int arity, int size, boolean wide) {
      StringBuilder b = new StringBuilder("{");
      for (int k = 0; k < arity; k++) {
         int v = t % size;
         t /= size;
         if (wide && rnd.nextInt(8) == 0) v = size;
         b.append(k == 0 ? "" : ",").append(v);
      }
      return b.append('}').toString();
   }

   static String status(LPInvalidation m) {
      m.evaluate();
      return m.titlePanel.statusPane.getText();
   }

   static String strip(String s) {
      return TaggedRecord.stripTimestamp(s);
   }

   static void problem(LPInvalidation m, String name, String arg, String interp) {
      String base = TaggedRecord.formatField(name, '$') + TaggedRecord.formatField(arg, '?') + TaggedRecord.formatField(interp, '=');
      m.loadProblem(base);
      List<SymbolInterpretation> syms = new ArrayList<>();
      for (Object o : m.symbols) syms.add((SymbolInterpretation) o);
      StringBuilder names = new StringBuilder();
      for (SymbolInterpretation s : syms) names.append(s instanceof PredicateInterpretation ? "P:" : "O:").append(s.encode()).append(' ');
      out.append("{\"base\":").append(q(base)).append(",\"symbols\":").append(q(names.toString())).append(",\"save0\":").append(q(strip(m.saveProblem())))
         .append(",\"status0\":").append(q(status(m))).append(",\"models\":[");
      boolean first = true;
      for (int size = 1; size <= 4; size++) {
         for (int c = 0; c < 4; c++) {
            StringBuilder list = new StringBuilder();
            for (SymbolInterpretation s : syms) list.append(list.length() == 0 ? "" : ".").append(genInterpretation(s, size));
            if (rnd.nextInt(6) == 0) list.append(".X(1){0}");
            if (rnd.nextInt(8) == 0) list.append(".junk");
            String rec = base.replace(TaggedRecord.formatField(interp, '='), "") + size + "`#" + TaggedRecord.formatField(list.toString(), '=');
            if (rnd.nextInt(4) == 0) rec += TaggedRecord.formatField(new Base64Codec(new Utf8Codec(rnd.nextBoolean() ? "∀x(Fx→Gx)" : "note " + c).encode()).toString(), '&');
            if (rnd.nextInt(5) == 0) rec += rnd.nextInt(5) + "`e";
            rec = TaggedRecord.toLine(rec);
            if (!first) out.append(",\n");
            first = false;
            model(m, rec, size);
         }
      }
      out.append("],\"expand\":[");
      first = true;
      ArgumentParser a = m.statement;
      List<String> texts = new ArrayList<>();
      if (a != null) {
         texts.addAll(Arrays.asList(a.premiseTexts));
         texts.add(a.conclusionText);
      }
      for (String t : texts) {
         String shown = LogicProgram.translateSymbols(t, LogicConstants.maggie, LogicProgram.symbols);
         for (int size = 1; size <= 3; size++) {
            for (int all = 0; all < 2; all++) {
               m.loadProblem(base);
               m.setSize(size);
               FormulaEntryField f = m.problemPanel.workspaceField;
               f.setText("<" + shown + ">");
               f.select(1, 1 + shown.length());
               String r;
               try {
                  m.expand(LogicProgram.variableLetter(0), all == 1);
                  r = f.getText();
               } catch (java.awt.HeadlessException x) {
                  r = "MSG";
               } catch (RuntimeException x) {
                  r = "X:" + x.getClass().getSimpleName();
               }
               if (!first) out.append(',');
               first = false;
               out.append('[').append(q(shown)).append(',').append(size).append(',').append(all == 1).append(',').append(q(r)).append(']');
            }
         }
      }
      out.append("],\"links\":[");
      first = true;
      for (int size = 1; size <= 3 && a != null; size++) {
         String s = "";
         try {
            String s1 = LogicProgram.variableLetter(0);
            for (int i = 0; i < a.premiseTexts.length; i++) s = s + (i != 0 ? " . " : "") + a.premises[i].expandQuantifiers(size, s1);
            s = s + " .: " + a.conclusion.expandQuantifiers(size, s1) + "`=";
         } catch (RuntimeException x) {
            s = "X:" + x.getClass().getSimpleName();
         }
         if (!first) out.append(',');
         first = false;
         out.append(q(s));
      }
      out.append("]}");
   }

   static void model(LPInvalidation m, String rec, int size) {
      m.loadProblem(rec);
      out.append("{\"rec\":").append(q(rec)).append(",\"save\":").append(q(strip(m.saveProblem()))).append(",\"check\":").append(m.checkProblem())
         .append(",\"status\":").append(q(status(m))).append(",\"state\":").append(LPInvalidation.getProblemState(rec)).append(",\"values\":[");
      if (m.statement != null) {
         for (Expression e : m.statement.premises) out.append(q(val(m.evaluate(LPInvalidation.closure(e))))).append(',');
         out.append(q(val(m.evaluate(LPInvalidation.closure(m.statement.conclusion)))));
      }
      out.append("],\"describe\":[");
      for (int i = 0; i < m.symbols.size(); i++) out.append(i == 0 ? "" : ",").append(q(((SymbolInterpretation) m.symbols.get(i)).describeValues(m.size)));
      out.append("],\"workspace\":").append(q(m.problemPanel.workspaceField.getText()));
      // shrink the universe
      int smaller = rnd.nextInt(size + 1);
      m.setSize(smaller);
      out.append(",\"shrink\":[").append(smaller).append(',').append(q(strip(m.saveProblem()))).append(']');
      // edit one symbol in the interpretation editor
      m.loadProblem(rec);
      out.append(",\"edit\":");
      if (m.symbols.isEmpty()) out.append("null");
      else {
         int k = rnd.nextInt(m.symbols.size());
         SymbolInterpretation s = (SymbolInterpretation) m.symbols.get(k);
         InterpretationEditor ed = new InterpretationEditor(s, size);
         StringBuilder init = new StringBuilder();
         StringBuilder ops = new StringBuilder();
         for (int r = 0; r < ed.rows; r++) {
            for (int c = 0; c < ed.columns; c++) {
               java.awt.Component comp = ed.gridLayout.getCellComponent(new Point(c, r));
               if (comp instanceof JCheckBox) {
                  JCheckBox cb = (JCheckBox) comp;
                  init.append(cb.getText()).append('=').append(cb.isSelected() ? 1 : 0).append(' ');
                  if (rnd.nextInt(3) == 0) {
                     cb.setSelected(!cb.isSelected());
                     ops.append(r).append(',').append(c).append(',').append(cb.isSelected() ? 1 : 0).append(' ');
                  }
               } else {
                  LabeledNumberChoice nc = (LabeledNumberChoice) comp;
                  init.append(((LogicLabel) nc.getComponent(0)).getText()).append('=').append(nc.getSelectedNumber()).append(' ');
                  if (rnd.nextInt(3) == 0) {
                     int v = rnd.nextInt(size);
                     nc.setSelectedNumber(v);
                     ops.append(r).append(',').append(c).append(',').append(v).append(' ');
                  }
               }
            }
         }
         ed.applyToSymbol();
         out.append('[').append(k).append(',').append(q(init.toString())).append(',').append(q(ops.toString())).append(',').append(q(s.encode()))
            .append(',').append(q(s.describeValues(size))).append(',').append(q(strip(m.saveProblem()))).append(',').append(q(status(m))).append(']');
      }
      out.append('}');
   }
}

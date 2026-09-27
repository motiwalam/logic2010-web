package edu.ucla.phil.logic;

import java.util.List;
import java.util.Vector;

/**
 * Rules oracle: the rule and theorem tables (names, forms, headings, properties, converses,
 * the RT rules of every theorem, findRule on odd names), ArgumentParser.matchRule for every
 * recognition argument and every rule and theorem, with the matches' instantiations, bound
 * variables, results and highlighted displays; SchemeInstantiation decode/encode of the
 * instantiations saved in the data files; PermutationIterator sequences.
 *   OracleRules <recognition-args.txt> <instantiations.txt>
 */
public class OracleRules {
   static StringBuilder out = new StringBuilder();

   static String q(Object o) {
      return Oracle.q(o);
   }

   static String list(Vector v) {
      if (v == null) return "null";
      StringBuilder b = new StringBuilder();
      for (Object o : v) b.append(b.length() > 0 ? "|" : "").append(o);
      return b.toString();
   }

   static String forms(Rule r) {
      if (r == null) return "null";
      StringBuilder b = new StringBuilder();
      for (SchematicRule f : r.getAllForms()) {
         b.append(b.length() > 0 ? " ; " : "").append(f.name).append('=').append(f.format(".", ".:"));
         RuleProperties p = LogicProgram.ruleTable.properties;
         b.append(" [").append(p.hasProperty(f, "notConditional") ? "nc " : "").append(p.hasProperty(f, "notConditionalBC") ? "ncbc " : "")
            .append(p.hasProperty(f, "biconditional") ? "bic " : "").append(p.hasProperty(f, "hasConverse") ? "conv " : "")
            .append(list(p.getConverses(f))).append(']');
         b.append(" from=").append(RuleProperties.getFromSide(f, false)).append(" to=").append(RuleProperties.getToSide(f, false));
         b.append(" rfrom=").append(OracleFormula.safe(() -> RuleProperties.getFromSide(f, true)));
         b.append(" cfrom=").append(OracleFormula.safe(() -> RuleProperties.getConditionalFromSide(f, true, false)));
         b.append(" cto=").append(OracleFormula.safe(() -> RuleProperties.getConditionalToSide(f, false, true)));
         b.append(" copy=").append(OracleFormula.safe(() -> f.copyRule().format(".", ".:")));
      }
      return b.toString();
   }

   static String rule(Rule r) {
      if (r == null) return "null";
      return r.getClass().getSimpleName() + ":" + r.name + ":" + r + ":" + (r.sourceTheorem == null ? "-" : r.sourceTheorem.name)
         + ":" + r.testProperty(LogicProgram.ruleTable.properties, "hasConverse", true)
         + ":" + r.testProperty(LogicProgram.ruleTable.properties, "biconditional", false) + ":" + forms(r);
   }

   static String params(java.util.Hashtable h) {
      if (h == null) return "";
      java.util.TreeMap m = new java.util.TreeMap(h);
      return m.toString();
   }

   static String display(RuleApplication a) {
      HighlightedText h = a.createDisplay(null).toHighlightedText();
      HighlightedText h2 = a.createDisplay(null).toHighlightedText(false);
      return text(h) + " / " + text(h2);
   }

   static String text(HighlightedText h) {
      StringBuilder b = new StringBuilder(h.text);
      if (h.layers != null) for (Object o : h.layers) b.append(' ').append(o);
      return b.toString();
   }

   public static void main(String[] args) throws Exception {
      Oracle.init();
      RuleTable table = LogicProgram.ruleTable;
      TheoremTable theorems = table.theorems;
      out.append("{\"syntax\":").append(FormulaParser.syntax).append(",\n\"rules\":[");
      boolean first = true;
      for (Object o : table.ruleNames) {
         String n = (String) o;
         out.append(first ? "\n" : ",\n").append(q(rule(table.getRule(n)) + " H=" + list((Vector) table.headings.get(n))));
         first = false;
      }
      out.append("],\n\"theorems\":[");
      first = true;
      java.util.Enumeration en = theorems.theoremNumbers.elements();
      while (en.hasMoreElements()) {
         Integer n = (Integer) en.nextElement();
         Theorem t = theorems.getTheorem(n);
         StringBuilder b = new StringBuilder();
         b.append(n).append(':').append(t).append(":H=").append(list((Vector) theorems.headings.get(n)));
         for (String suffix : new String[] {"", "L", "LF", "R", "RF", "X"}) b.append(" || RT").append(n).append(suffix).append("=").append(rule(table.findRule("RT" + n + suffix)));
         b.append(" || T=").append(rule(table.findRule("t" + n)));
         out.append(first ? "\n" : ",\n").append(q(b));
         first = false;
      }
      out.append("],\n\"converseRules\":").append(q(list(table.properties.getRulesWithConverse(table))));
      out.append(",\n\"converseTheorems\":").append(q(table.properties.getTheoremsWithConverse(theorems)));
      out.append(",\n\"find\":[");
      first = true;
      for (String n : new String[] {"dn", "DN", "T0", "T01", "t2", "RT0", "RT01", "rt2", "RT2L", "RT99999", "T99999", "XYZ", "RT1x", "Mp", "S"}) {
         out.append(first ? "" : ",").append(q(n + "=" + rule(table.findRule(n))));
         first = false;
      }
      out.append("],\n\"recognition\":[");
      List<String> arguments = OracleFormula.readInputs(args[0]);
      Vector names = new Vector(table.ruleNames);
      for (int i = 1; i <= 60; i += 7) names.addElement("T" + i);
      names.addElement("RT4");
      names.addElement("RT32L");
      first = true;
      for (String argument : arguments) {
         ArgumentParser p = new ArgumentParser(ArgumentParser.normalizeDots(argument));
         StringBuilder b = new StringBuilder(argument + " => " + p + " err=" + p.describeError(true, true) + " cond=" + p.toConditional());
         for (Object o : names) {
            String n = (String) o;
            int code;
            try {
               code = p.matchRule(table.findRule(n));
            } catch (Throwable t) {
               b.append(" || ").append(n).append("=").append(OracleFormula.err(t));
               continue;
            }
            if (code == 0) continue;
            b.append(" || ").append(n).append("=").append(code).append(" pm=").append(p.premiseMatches.length);
            for (RuleApplication a : p.premiseMatches) {
               b.append(" {").append(a.form.name).append(ExpressionPath.format(a.premiseOrder)).append(a.instantiation.encode())
                  .append(" pend=").append(a.instantiation.pendingLettersToString())
                  .append(" d=").append(OracleFormula.safe(() -> display(a))).append('}');
            }
            if (p.fullMatches != null) {
               for (RuleApplication a : p.fullMatches) {
                  b.append(" [").append(a.form.name).append(ExpressionPath.format(a.premiseOrder)).append(a.instantiation.encode())
                     .append(",").append(a.boundVariables.encode()).append(" pend=").append(a.instantiation.pendingLettersToString())
                     .append(" c=").append(OracleFormula.safe(() -> a.getConclusion()))
                     .append(" d=").append(OracleFormula.safe(() -> display(a)))
                     .append(" dec=").append(OracleFormula.safe(() -> {
                        SchemeInstantiation d = SchemeInstantiation.decode(a.instantiation.encode());
                        return d == null ? "null" : d.encode() + "/" + BoundVariableMap.decode(a.boundVariables.encode()).encode();
                     })).append(']');
               }
            }
         }
         out.append(first ? "\n" : ",\n").append(q(b));
         first = false;
      }
      out.append("],\n\"instantiations\":[");
      first = true;
      for (String s : OracleFormula.readInputs(args[1])) {
         String r = OracleFormula.safe(() -> {
            SchemeInstantiation d = SchemeInstantiation.decode(s);
            if (d == null) return "null";
            StringBuilder b = new StringBuilder(d.encode());
            java.util.Enumeration k = d.keys();
            while (k.hasMoreElements()) {
               SchematicLetter l = (SchematicLetter) k.nextElement();
               b.append(" ").append(l).append("->").append(d.getReplacement(l).replacement);
            }
            SchemeInstantiation c = (SchemeInstantiation) d.clone();
            c.addReplacement("Z", "~Z");
            return b + " clone=" + c.encode() + " err=" + c.errorId;
         });
         out.append(first ? "" : ",\n").append(q(s + " => " + r));
         first = false;
      }
      out.append("],\n\"schemes\":[");
      List<Expression> sample = new java.util.ArrayList<>();
      int k = 0;
      for (String s : OracleFormula.readInputs(args[2])) {
         try {
            Expression e = LogicProgram.parseFormula(s);
            if (e != null && k++ % 9 == 0 && sample.size() < 120) sample.add(e);
         } catch (Throwable t) {
         }
      }
      first = true;
      for (Object o : table.ruleNames) {
         for (SchematicRule f : table.getRule((String) o).getAllForms()) {
            if (f.premises.length == 0) continue;
            StringBuilder b = new StringBuilder(f.name);
            for (Expression e : sample) {
               SchemeInstantiation inst = new SchemeInstantiation();
               boolean ok;
               try {
                  ok = f.premises[0].match(e, inst);
               } catch (Throwable t) {
                  b.append(" | ").append(e).append(" ").append(OracleFormula.err(t));
                  continue;
               }
               String extra = OracleFormula.safe(() -> {
                  SchemeInstantiation c = new SchemeInstantiation();
                  boolean r1 = f.conclusion.match(e, c);
                  String r = r1 + ":" + c.errorId + params(c.errorParams) + ":" + c.encode() + ":" + c.pendingLettersToString();
                  if (f.premises.length > 1 && sample.indexOf(e) % 8 == 0) {
                     for (int j = 0; j < sample.size(); j += 5) {
                        SchemeInstantiation d = new SchemeInstantiation();
                        SchemeInstantiation d2 = new SchemeInstantiation();
                        boolean a1 = f.premises[0].match(e, d);
                        boolean a2 = a1 && f.premises[1].match(sample.get(j), d2) && d.mergeFrom(d2);
                        if (a2 || d.errorId != null) r += " two" + j + "=" + a1 + a2 + ":" + d.errorId + params(d.errorParams) + ":" + d.encode() + ":" + d.pendingLettersToString();
                     }
                  }
                  return r;
               });
               if (!extra.startsWith("false:null:") || extra.contains("true")) b.append(" x=").append(extra);
               if (!ok && inst.errorId == null) continue;
               b.append(" | ").append(e).append(" ").append(ok).append(" ").append(inst.errorId).append(params(inst.errorParams));
               if (ok) {
                  b.append(" ").append(inst.encode()).append(" pend=").append(inst.pendingLettersToString())
                     .append(" c=").append(OracleFormula.safe(() -> f.conclusion.instantiate(inst)))
                     .append(" full=").append(OracleFormula.safe(() -> f.conclusion.isFullyInstantiated(inst)))
                     .append(" fresh=").append(OracleFormula.safe(() -> {
                        SchemeInstantiation c = (SchemeInstantiation) inst.clone();
                        SchemeInstantiation fr = c.assignFreshLetters(f.conclusion);
                        return fr.pendingLettersToString() + "/" + c.encode() + "/" + f.conclusion.instantiate(c);
                     }));
               }
            }
            out.append(first ? "\n" : ",\n").append(q(b));
            first = false;
         }
      }
      out.append("],\n\"cases\":[");
      first = true;
      for (String r : new String[] {"F{1}:G{1}", "F({1}{1}):G{1}", "F(a):Ga", "a:Fa", "A:Fa", "P:a", "F{1}:{1}", "@xFx:P", "P&Q:R", "x:y", "noColon", "F{1}:G{2}", "A({1}):B({1}{1})", "a:A(b)", "P:(", "{1}:a", "F({1}{2}):G({2}{1})", "P:?A", "F{1}:@x(Fx&G{1})"}) {
         SchemeInstantiation d = new SchemeInstantiation();
         boolean ok = d.parseReplacement(r);
         out.append(first ? "" : ",").append(q(r + " " + ok + " " + d.errorId + params(d.errorParams) + " " + d.encode()));
         first = false;
      }
      String[][] pairs = new String[][] {{"@xFA", "@yGy"}, {"@x@yF(xx)", "@x@yG(xy)"}, {"@x@yF(xy)", "@x@yG(xx)"}, {"@xFx", "@y(Gy&P)"}, {"Fa", "Gb"}, {"a=A", "b=c"}, {"@x(Fx&Fx)", "@y(Gy&Hy)"}, {"@x(Fx->P)", "@y(Gy->Q)"}, {"@xF(xA)", "@yG(yb)"}, {"!x(Fx&Gx)", "!y(Hy&Iy)"}, {"@xFx", "@yFA"}, {"%xFx=a", "%yGy=b"}, {"@x(Fx&P)", "@y(Gy&y=y)"}, {"F(A)", "P&Q"}, {"@x@yF(xy)", "@z@wG(wz)"}, {"@xFx", "@y@zG(yz)"}, {"@x(Fx&Gx)", "@y(Hy&Hy)"}, {"@xA(x)=a", "@yb(y)=c"}, {"@x!yF(xy)", "@z!wG(zw)"}, {"@xFx", "@y!zG(yz)"}};
      for (String[] pr : pairs) {
         out.append(",").append(q(pr[0] + " ~ " + pr[1] + " " + OracleFormula.safe(() -> {
            Expression a = LogicProgram.parseFormula(pr[0], true, true), b = LogicProgram.parseFormula(pr[1], true, true);
            SchemeInstantiation d = new SchemeInstantiation();
            BinderMap bm = new BinderMap();
            boolean ok = a.match(b, d, bm);
            BoundVariableMap bv = new BoundVariableMap();
            return ok + " " + d.errorId + params(d.errorParams) + " " + d.encode() + " pend=" + d.pendingLettersToString()
               + " nodef=" + d.hasNoDeferredMatches() + " inst=" + OracleFormula.safe(() -> a.instantiate(d)) + " bv=" + bv.matchBinders(a, b, bm) + ":" + bv.encode()
               + " vm=" + OracleFormula.safe(() -> new BoundVariableMap().matches(a, b, d));
         })));
      }
      out.append("],\n\"permutations\":[");
      for (int n = 0; n <= 4; n++) {
         PermutationIterator it = new PermutationIterator(n);
         StringBuilder b = new StringBuilder();
         do b.append(it).append(ExpressionPath.format(it.getCounters() == null ? new int[0] : it.getCounters())); while (it.next());
         b.append(" end ").append(it);
         out.append(n == 0 ? "" : ",").append(q(b));
      }
      out.append("]}\n");
      System.out.print(out);
   }
}

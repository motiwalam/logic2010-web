package edu.ucla.phil.logic;

import java.awt.Dialog;
import java.awt.Frame;
import java.awt.event.WindowFocusListener;
import javax.swing.JPanel;
import javax.swing.JRootPane;

/**
 * Oracle shadow of BaseDialog: a plain panel instead of a JDialog, so that the derivation's
 * dialogs can be built headless. MessageDialog (also shadowed) hands them to OracleDialogs.
 */
class BaseDialog extends JPanel {
   Frame ownerFrame;
   boolean modal = true;
   String title;
   JRootPane rootPane = new JRootPane();

   BaseDialog(Frame frame) { this.ownerFrame = frame; }
   BaseDialog(Frame frame, boolean flag) { this.ownerFrame = frame; this.modal = flag; }
   BaseDialog(Frame frame, String s) { this.ownerFrame = frame; this.title = s; }
   BaseDialog(Frame frame, String s, boolean flag) { this.ownerFrame = frame; this.title = s; this.modal = flag; }
   BaseDialog(Dialog dialog) { }
   BaseDialog(Dialog dialog, boolean flag) { this.modal = flag; }
   BaseDialog(Dialog dialog, String s) { this.title = s; }
   BaseDialog(Dialog dialog, String s, boolean flag) { this.title = s; this.modal = flag; }

   Frame getOwnerFrame() { return this.ownerFrame; }
   public void pack() { }
   public void dispose() { }
   public boolean isModal() { return this.modal; }
   public void setModal(boolean flag) { this.modal = flag; }
   public void setResizable(boolean flag) { }
   public void setTitle(String s) { this.title = s; }
   public String getTitle() { return this.title; }
   @Override public JRootPane getRootPane() { return this.rootPane; }
   public void addWindowFocusListener(WindowFocusListener l) { }
   public void setDefaultCloseOperation(int i) { }
   public void toFront() { }
   @Override public void show() { }
}

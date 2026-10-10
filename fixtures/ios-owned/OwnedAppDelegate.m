// SPDX-License-Identifier: AGPL-3.0-only
// Owned, network-free CI/UIKit fixture. NEVER a customer iOS application.
#import <UIKit/UIKit.h>
#import <Foundation/Foundation.h>

@interface OwnedIOSAppDelegate : UIResponder <UIApplicationDelegate>
@property(nonatomic,strong) UIWindow *window;
@end

@implementation OwnedIOSAppDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    (void)application;(void)options;
    self.window = [[UIWindow alloc] initWithFrame:[[UIScreen mainScreen] bounds]];
    UIViewController *controller = [[UIViewController alloc] init];
    controller.view.backgroundColor =
      [UIColor colorWithRed:(18.0/255.0) green:(39.0/255.0)
                      blue:(59.0/255.0) alpha:1.0];

    UILabel *label = [[UILabel alloc] initWithFrame:CGRectZero];
    label.translatesAutoresizingMaskIntoConstraints = NO;
    label.text = @"LAUNCHWRIGHT\nOWNED IOS FIXTURE\nSIMULATOR ONLY";
    label.textAlignment = NSTextAlignmentCenter;
    label.numberOfLines = 4;
    label.textColor = [UIColor whiteColor];
    label.font = [UIFont systemFontOfSize:29.0 weight:UIFontWeightSemibold];
    [controller.view addSubview:label];
    [NSLayoutConstraint activateConstraints:@[
      [label.centerXAnchor constraintEqualToAnchor:controller.view.centerXAnchor],
      [label.centerYAnchor constraintEqualToAnchor:controller.view.centerYAnchor],
      [label.widthAnchor constraintLessThanOrEqualToAnchor:controller.view.widthAnchor
                                                 multiplier:0.87]
    ]];

    UIView *accent = [[UIView alloc] initWithFrame:CGRectZero];
    accent.translatesAutoresizingMaskIntoConstraints = NO;
    accent.backgroundColor =
      [UIColor colorWithRed:(53.0/255.0) green:(202.0/255.0)
                      blue:(178.0/255.0) alpha:1.0];
    [controller.view addSubview:accent];
    [NSLayoutConstraint activateConstraints:@[
      [accent.topAnchor constraintEqualToAnchor:label.bottomAnchor constant:28.0],
      [accent.centerXAnchor constraintEqualToAnchor:controller.view.centerXAnchor],
      [accent.widthAnchor constraintEqualToConstant:170.0],
      [accent.heightAnchor constraintEqualToConstant:6.0]
    ]];

    self.window.rootViewController = controller;
    [self.window makeKeyAndVisible];
    return YES;
}
@end

int main(int argc, char **argv) {
  @autoreleasepool {
    return UIApplicationMain(argc, argv, nil,
                             NSStringFromClass([OwnedIOSAppDelegate class]));
  }
}
